import { execFile } from 'node:child_process';
import {
  appendFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { delimiter, isAbsolute, join, relative, sep } from 'node:path';
import { promisify } from 'node:util';
import type { OrcaWorkerApi } from 'orca/worker';
import type { DiffPayload } from '../shared/diff';
import { makeT, resolveLang, type Translate } from '../shared/i18n';
import { statusBarState, summarize } from '../shared/summary';
import { pickWorkspace } from '../shared/workspace';
import type {
  Branch,
  ChangedFile,
  FetchResult,
  FileCommit,
  FileEntry,
  FileGroup,
  GraphCommit,
  GraphRef,
  OpenFailure,
  RepoStatus,
} from './protocol';

const run = promisify(execFile);
const STATUS_BAR_POLL_MS = 120_000;

const GIT_ENV = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' };
const MAX_GIT_PROCS = 6;
const MAX_FILES = 2000;
let gitBusy = 0;
const gitWaiters: Array<() => void> = [];

/** Limita i processi git concorrenti (molti repo, fetch su ssh): gli altri aspettano il turno. */
async function withSlot<T>(job: () => Promise<T>): Promise<T> {
  if (gitBusy >= MAX_GIT_PROCS) await new Promise<void>((res) => gitWaiters.push(res));
  else gitBusy++;
  try {
    return await job();
  } finally {
    const next = gitWaiters.shift();
    if (next) next();
    else gitBusy--;
  }
}

/**
 * Esegue git su un repo che può non essere fidato: niente fsmonitor (comando arbitrario da
 * `.git/config`), niente lock opzionali dell'indice (il polling non deve bloccare l'utente).
 */
async function git(cwd: string, args: string[], timeout = 15_000): Promise<string> {
  try {
    const { stdout } = await withSlot(() =>
      run('git', ['-c', 'core.fsmonitor=false', ...args], {
        cwd,
        timeout,
        maxBuffer: 8 << 20,
        env: GIT_ENV,
      }),
    );
    return stdout;
  } catch (e) {
    if ((e as { code?: unknown }).code === 'ENOENT')
      throw new Error('git not found in PATH');
    throw e;
  }
}

const HASH_RE = /^[0-9a-f]{4,40}$/i;

export function assertHash(hash: string): string {
  if (typeof hash !== 'string' || !HASH_RE.test(hash))
    throw new Error('invalid commit hash');
  return hash;
}

/** Percorso relativo al repo: niente assoluti, NUL o segmenti `..`. */
export function assertRel(file: string): string {
  if (
    typeof file !== 'string' ||
    !file ||
    file.includes('\0') ||
    isAbsolute(file) ||
    file.split(/[\\/]/).includes('..')
  ) {
    throw new Error('invalid path');
  }
  return file;
}

export function clampLimit(limit: unknown, max = 5000): number {
  const n = Number(limit);
  return Number.isInteger(n) ? Math.min(Math.max(n, 1), max) : 300;
}

export function parseStatus(
  out: string,
): Omit<RepoStatus, 'name' | 'path' | 'stash' | 'lastCommitAt' | 'lastCommitSubject'> {
  const r = {
    branch: '',
    detached: false,
    upstream: null as string | null,
    ahead: 0,
    behind: 0,
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicts: 0,
  };
  for (const line of out.split('\n')) {
    if (line.startsWith('# branch.head ')) {
      const h = line.slice(14);
      r.detached = h === '(detached)';
      r.branch = h;
    } else if (line.startsWith('# branch.upstream ')) r.upstream = line.slice(18);
    else if (line.startsWith('# branch.ab ')) {
      const m = /\+(\d+) -(\d+)/.exec(line);
      if (m) {
        r.ahead = Number(m[1]);
        r.behind = Number(m[2]);
      }
    } else if (line.startsWith('1 ') || line.startsWith('2 ')) {
      if (line[2] !== '.') r.staged++;
      if (line[3] !== '.') r.unstaged++;
    } else if (line.startsWith('u ')) r.conflicts++;
    else if (line.startsWith('? ')) r.untracked++;
  }
  return r;
}

async function repoStatus(root: string, name: string): Promise<RepoStatus> {
  const path = join(root, name);
  try {
    const [st, stash, log] = await Promise.all([
      git(path, ['status', '--porcelain=v2', '--branch']),
      git(path, ['stash', 'list']),
      git(path, ['log', '-1', '--format=%ct%x09%s']).catch(() => ''),
    ]);
    const [ct, ...subj] = log.trim().split('\t');
    return {
      name,
      path,
      ...parseStatus(st),
      stash: stash.split('\n').filter(Boolean).length,
      lastCommitAt: ct ? Number(ct) * 1000 : null,
      lastCommitSubject: subj.join('\t'),
    };
  } catch (e) {
    return {
      name,
      path,
      branch: '',
      detached: false,
      upstream: null,
      ahead: 0,
      behind: 0,
      staged: 0,
      unstaged: 0,
      untracked: 0,
      conflicts: 0,
      stash: 0,
      lastCommitAt: null,
      lastCommitSubject: '',
      error: String((e as Error).message),
    };
  }
}

async function isRepo(dir: string): Promise<boolean> {
  try {
    await stat(join(dir, '.git'));
    return true;
  } catch {
    return false;
  }
}

async function repoNames(root: string): Promise<string[]> {
  if (!root) return [];
  const entries = await readdir(root, { withFileTypes: true });
  const names: string[] = [];
  for (const e of entries) {
    if (e.isDirectory() && !e.name.startsWith('.') && (await isRepo(join(root, e.name))))
      names.push(e.name);
  }
  return names.sort();
}

type Ws = { id: string; kind: string; name: string; path: string; branch: string | null };
type WsMatch = { ws: Ws; rel: string };

/**
 * Cartelle dei terminali del workspace attivo, per distinguere workspace omonimi: gli id di
 * `readContext` sono gli stessi di `orca terminal list`, che li associa a un `worktreePath`.
 * Lista vuota se la CLI non c'è o fallisce (si ricade sull'ambiguità dichiarata).
 */
async function terminalPaths(terminals: { id: string }[]): Promise<string[]> {
  if (terminals.length === 0) return [];
  const bin = await orcaBin();
  if (!bin) return [];
  try {
    const { stdout } = await run(bin, ['terminal', 'list', '--json'], {
      timeout: 10_000,
    });
    const all = (JSON.parse(stdout).result?.terminals ?? []) as {
      handle?: string;
      worktreePath?: string;
    }[];
    const ids = new Set(terminals.map((t) => t.id));
    return all
      .filter((t) => t.handle && ids.has(t.handle) && t.worktreePath)
      .map((t) => t.worktreePath as string);
  } catch {
    return [];
  }
}

/** Cartella da scansionare: figli-repo del workspace attivo, altrimenti il setting rootDir. */
async function resolveRoot(
  orca: OrcaWorkerApi,
): Promise<{ root: string; source: string }> {
  const fallback = String((await orca.settings.get('rootDir')) ?? '');
  try {
    const ctx = (await orca.host.call('workspace.readContext', {})) as {
      displayName: string;
      branch: string;
      terminals: { id: string }[];
    } | null;
    const { workspaces } = (await orca.host.call('workspace.list', {})) as {
      workspaces: Ws[];
    };
    const pick = ctx
      ? pickWorkspace(workspaces, ctx, await terminalPaths(ctx.terminals))
      : ({ kind: 'none' } as const);
    if (pick.kind === 'ambiguous') return { root: fallback, source: 'ambiguous' };
    const ws = pick.kind === 'found' ? pick.ws : undefined;
    if (ws) {
      if ((await repoNames(ws.path)).length > 0)
        return { root: ws.path, source: `workspace:${ws.name}` };
      if (await isRepo(ws.path))
        return { root: join(ws.path, '..'), source: `parent:${ws.name}` };
    }
  } catch {
    // niente contesto: si usa il setting
  }
  return { root: fallback, source: 'setting' };
}

/** Riga utile di un errore di git: la prima `fatal:`/`error:` (senza prefisso), altrimenti l'ultima non vuota. */
export function gitErrorLine(message: string): string {
  const lines = message
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const hit = lines.find((l) => /^(fatal|error):/i.test(l));
  return (hit ? hit.replace(/^(fatal|error):\s*/i, '') : lines.at(-1)) ?? '';
}

export function parseFiles(out: string): ChangedFile[] {
  const files: ChangedFile[] = [];
  for (const line of out.split('\n')) {
    const t = line[0];
    if (t === '1' || t === '2') {
      const xy = line.slice(2, 4);
      const rest = line
        .split(' ')
        .slice(t === '1' ? 8 : 9)
        .join(' ');
      const [path, orig] = rest.split('\t');
      // Niente chiavi undefined: l'host rifiuta valori non JSON.
      const origPath = orig ? { origPath: orig } : {};
      if (xy[0] !== '.')
        files.push({
          path,
          ...origPath,
          code: xy[0],
          group: 'staged',
          added: null,
          deleted: null,
        });
      if (xy[1] !== '.')
        files.push({
          path,
          ...origPath,
          code: xy[1],
          group: 'unstaged',
          added: null,
          deleted: null,
        });
    } else if (t === 'u') {
      files.push({
        path: line.split(' ').slice(10).join(' '),
        code: 'U',
        group: 'conflict',
        added: null,
        deleted: null,
      });
    } else if (t === '?') {
      files.push({
        path: line.slice(2),
        code: '?',
        group: 'untracked',
        added: null,
        deleted: null,
      });
    }
  }
  return files;
}

const MAX_DIFF = 400_000;

/** Argomenti git per il diff di un file con contesto completo, secondo il gruppo. */
function diffArgs(file: string, group: FileGroup): string[] {
  assertRel(file);
  switch (group) {
    case 'staged':
      return [
        'diff',
        '--no-ext-diff',
        '--no-textconv',
        '--cached',
        '-U1000000',
        '--',
        file,
      ];
    case 'untracked':
      return [
        'diff',
        '--no-ext-diff',
        '--no-textconv',
        '--no-index',
        '-U1000000',
        '--',
        '/dev/null',
        file,
      ];
    default:
      return ['diff', '--no-ext-diff', '--no-textconv', '-U1000000', '--', file];
  }
}

const ORCA_DIRS = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/usr/bin',
  '/Applications/Orca.app/Contents/Resources/bin',
];

/** CLI `orca`: prima le cartelle del PATH, poi quelle di installazione note. Null se non si trova. */
async function orcaBin(): Promise<string | null> {
  const dirs = [
    ...(process.env.PATH ?? '').split(delimiter).filter(Boolean),
    ...ORCA_DIRS,
  ];
  for (const d of dirs) {
    const b = join(d, process.platform === 'win32' ? 'orca.cmd' : 'orca');
    try {
      await stat(b);
      return b;
    } catch {
      /* prossimo */
    }
  }
  return null;
}

/** Diff nativo di Orca (tab del workspace del repo, portato in primo piano). Null se non disponibile. */
async function nativeDiff(
  repoPath: string,
  file: string,
  group: FileGroup,
): Promise<string | null> {
  if (group === 'untracked') return null;
  const bin = await orcaBin();
  if (!bin) return null;
  const args = [
    'file',
    'diff',
    file,
    '--worktree',
    `path:${repoPath}`,
    '--focus',
    '--json',
  ];
  if (group === 'staged') args.push('--staged');
  try {
    const { stdout } = await run(bin, args, { timeout: 15_000 });
    return JSON.parse(stdout).result?.opened === true ? 'ok' : null;
  } catch {
    return null;
  }
}

/**
 * Come `git`, ma tollera i due casi in cui lo stdout è comunque valido: exit code 1
 * (`diff --no-index` esce 1 se differisce) e buffer pieno (il chiamante tronca a MAX_DIFF).
 */
async function gitDiff(cwd: string, args: string[]): Promise<string> {
  try {
    return await git(cwd, args);
  } catch (e) {
    const err = e as { stdout?: string; code?: unknown };
    const tolerated = err.code === 1 || err.code === 'ERR_CHILD_PROCESS_STDOUT_MAXBUFFER';
    if (tolerated && typeof err.stdout === 'string' && err.stdout.length > 0)
      return err.stdout;
    throw e;
  }
}

async function cappedDiff(
  cwd: string,
  args: string[],
): Promise<{ diff: string; truncated: boolean }> {
  return capDiff(await gitDiff(cwd, ['-c', 'core.quotepath=false', ...args]));
}

/** Tronca il diff a MAX_DIFF caratteri e segnala se è successo. */
export function capDiff(full: string): { diff: string; truncated: boolean } {
  const truncated = full.length > MAX_DIFF;
  return { diff: truncated ? full.slice(0, MAX_DIFF) : full, truncated };
}

/** Argomenti git per il diff di un file dentro un commit (merge: rispetto al primo genitore). */
function commitDiffArgs(hash: string, file: string, origFile?: string): string[] {
  const paths =
    origFile && origFile !== file
      ? [assertRel(origFile), assertRel(file)]
      : [assertRel(file)];
  return [
    'show',
    '--no-ext-diff',
    '--no-textconv',
    '-m',
    '--first-parent',
    '--format=',
    '-M',
    '-U1000000',
    assertHash(hash),
    '--',
    ...paths,
  ];
}

export function parseBranches(out: string): Branch[] {
  const res: Branch[] = [];
  for (const line of out.split('\n').filter(Boolean)) {
    const [ref, name, upstream, track, ct, head] = line.split('\t');
    if (ref.endsWith('/HEAD')) continue;
    res.push({
      name,
      remote: ref.startsWith('refs/remotes/'),
      current: head === '*',
      upstream: upstream || null,
      track: track || '',
      at: ct ? Number(ct) * 1000 : null,
    });
  }
  return res;
}

const LOG_LIMIT = 200;

/** Output di `git log --follow --name-only` con record separati da \x01. */
export function parseFileLog(out: string): FileCommit[] {
  const res: FileCommit[] = [];
  for (const rec of out.split('\x01').filter((r) => r.trim())) {
    const [head, ...files] = rec.split('\n');
    const [hash, author, ct, ...subj] = head.split('\t');
    const path = files.find((f) => f.trim());
    if (!hash || !path) continue;
    res.push({ hash, author, at: Number(ct) * 1000, subject: subj.join('\t'), path });
  }
  return res;
}

/** Decorazioni di `%D` ("HEAD -> develop, origin/develop, tag: v1") in riferimenti tipizzati. */
export function parseRefs(decor: string, remotes: string[]): GraphRef[] {
  const refs: GraphRef[] = [];
  for (const raw of decor.split(', ').filter(Boolean)) {
    let name = raw;
    let current = false;
    if (name === 'HEAD') continue;
    if (name.startsWith('HEAD -> ')) {
      name = name.slice(8);
      current = true;
    }
    if (name.startsWith('tag: ')) refs.push({ name: name.slice(5), kind: 'tag' });
    else if (name.endsWith('/HEAD')) continue;
    else if (remotes.some((r) => name.startsWith(`${r}/`)))
      refs.push({ name, kind: 'remote' });
    else refs.push({ name, kind: 'head', ...(current ? { current } : {}) });
  }
  return refs;
}

export function parseGraphLog(out: string, remotes: string[]): GraphCommit[] {
  const res: GraphCommit[] = [];
  for (const rec of out.split('\x01').filter((r) => r.trim())) {
    const [hash, parents, author, ct, decor, ...subj] = rec
      .replace(/\n$/, '')
      .split('\t');
    if (!hash) continue;
    res.push({
      hash,
      author,
      at: Number(ct) * 1000,
      subject: subj.join('\t'),
      parents: parents ? parents.split(' ') : [],
      refs: parseRefs(decor ?? '', remotes),
    });
  }
  return res;
}

/** Output di `git show --name-status` (R/C con due percorsi) in file di un commit. */
export function parseNameStatus(out: string): FileEntry[] {
  const files: FileEntry[] = [];
  for (const line of out.split('\n').filter(Boolean)) {
    const [st, a, b] = line.split('\t');
    if (!st || !a) continue;
    const base = { code: st[0], added: null, deleted: null };
    files.push(b ? { path: b, origPath: a, ...base } : { path: a, ...base });
  }
  return files;
}

/** Output di `git show --numstat -z`: righe aggiunte/tolte per percorso (nuovo, se rinominato). */
export function parseNumstatZ(out: string): Map<string, [number | null, number | null]> {
  const stats = new Map<string, [number | null, number | null]>();
  const tok = out.split('\0');
  for (let i = 0; i < tok.length; i++) {
    const [a, d, p] = tok[i].replace(/^\n/, '').split('\t');
    if (a === undefined || d === undefined || p === undefined) continue;
    // Rinomina: "a\td\t" seguito dai due percorsi (vecchio, nuovo).
    const path = p === '' ? tok[(i += 2)] : p;
    stats.set(path, [a === '-' ? null : Number(a), d === '-' ? null : Number(d)]);
  }
  return stats;
}

export default function activate(orca: OrcaWorkerApi): void {
  /** Traduttore nella lingua scelta nel setting `language` (auto = lingua del sistema). */
  const translator = async (): Promise<Translate> =>
    makeT(
      resolveLang(
        await orca.settings.get('language'),
        Intl.DateTimeFormat().resolvedOptions().locale,
      ),
    );

  // Repo noti (figli della cartella scansionata): ogni handler rifiuta path che non ne fanno parte.
  const known = new Set<string>();
  async function assertRepo(path: string): Promise<string> {
    if (typeof path !== 'string' || !isAbsolute(path))
      throw new Error('invalid repository');
    if (!known.has(path)) {
      const { root } = await resolveRoot(orca);
      known.clear();
      for (const n of await repoNames(root)) known.add(join(root, n));
    }
    if (!known.has(path)) throw new Error('invalid repository');
    return path;
  }

  /** Un file non tracciato non deve uscire dal repo tramite symlink di cartella. */
  async function assertInside(repo: string, file: string): Promise<void> {
    const [base, target] = await Promise.all([
      realpath(repo),
      realpath(join(repo, file)),
    ]);
    if (target !== base && !target.startsWith(base + sep))
      throw new Error('path outside the repository');
  }

  orca.panels.handle('repos.fetch', async () => {
    const t0 = Date.now();
    const { root } = await resolveRoot(orca);
    const names = await repoNames(root);
    const results: FetchResult[] = await Promise.all(
      names.map((name) =>
        git(join(root, name), ['fetch', '--quiet', '--no-tags'], 120_000).then(
          () => ({ name }),
          (e: Error) => ({ name, error: gitErrorLine(String(e.message)) }),
        ),
      ),
    );
    void updateStatusBar();
    return { total: names.length, results, tookMs: Date.now() - t0 };
  });

  async function scanRepos(): Promise<{
    root: string;
    source: string;
    repos: RepoStatus[];
  }> {
    const { root, source } = await resolveRoot(orca);
    const names = await repoNames(root);
    known.clear();
    for (const n of names) known.add(join(root, n));
    return {
      root,
      source,
      repos: await Promise.all(names.map((n) => repoStatus(root, n))),
    };
  }

  /** Voce della status bar: contatori del gruppo di repo. Mai fatale: il pannello funziona anche senza. */
  async function updateStatusBar(repos?: RepoStatus[]): Promise<void> {
    try {
      const list = repos ?? (await scanRepos()).repos;
      const { text, tone } = statusBarState(summarize(list), await translator());
      await orca.host.call('statusBar.update', {
        id: 'summary',
        text,
        tone,
        tooltip: (await translator())('sbTip'),
      });
    } catch {
      // status bar non disponibile (Orca più vecchio, plugin disabilitato): si ignora
    }
  }

  orca.panels.handle('repos.list', async () => {
    const t0 = Date.now();
    const { root, source, repos } = await scanRepos();
    void updateStatusBar(repos);
    return { root, source, repos, tookMs: Date.now() - t0 };
  });

  // Aggiornamento periodico (solo lettura: `git status`, nessun fetch) anche a pannello chiuso.
  void updateStatusBar();
  setInterval(() => void updateStatusBar(), STATUS_BAR_POLL_MS);

  orca.panels.handle('repo.files', async ({ path }) => {
    await assertRepo(path);
    const q = ['-c', 'core.quotepath=false'];
    // Statistiche separate: un file può essere sia staged che modificato, con numeri diversi.
    const [st, numStaged, numUnstaged] = await Promise.all([
      git(path, [...q, 'status', '--porcelain=v2', '--untracked-files=all']),
      git(path, [
        ...q,
        'diff',
        '--no-ext-diff',
        '--cached',
        '--numstat',
        '-z',
        '-M',
      ]).catch(() => ''),
      git(path, [...q, 'diff', '--no-ext-diff', '--numstat', '-z']).catch(() => ''),
    ]);
    const stats = {
      staged: parseNumstatZ(numStaged),
      unstaged: parseNumstatZ(numUnstaged),
    };
    const files = parseFiles(st).map((f) => {
      const s =
        f.group === 'staged' || f.group === 'unstaged'
          ? stats[f.group].get(f.path)
          : undefined;
      return s ? { ...f, added: s[0], deleted: s[1] } : f;
    });
    // Tetto: decine di migliaia di righe bloccherebbero il pannello (es. node_modules non ignorata).
    return { files: files.slice(0, MAX_FILES), total: files.length };
  });

  /** Workspace Orca del repo, portato in primo piano (editor.open da solo apre il tab in background). */
  async function showWorkspace(path: string): Promise<WsMatch | null> {
    const m = await findWorkspace(path);
    if (m) await orca.host.call('workspace.open', { workspaceId: m.ws.id });
    return m;
  }

  /** Workspace del repo: quello con lo stesso path, altrimenti il più profondo che lo contiene (repo in sottocartella). */
  async function findWorkspace(path: string): Promise<WsMatch | null> {
    const { workspaces } = (await orca.host.call('workspace.list', {})) as {
      workspaces: Ws[];
    };
    let best: WsMatch | null = null;
    for (const ws of workspaces) {
      const r = relative(ws.path, path);
      if (r.startsWith('..') || isAbsolute(r)) continue;
      if (!best || r.length < best.rel.length) best = { ws, rel: r };
    }
    return best;
  }

  /** `editor.open` vuole percorsi relativi al workspace: antepone la sottocartella del repo. */
  const inWorkspace = (m: WsMatch, file: string): string =>
    m.rel ? `${m.rel}/${file}` : file;

  orca.panels.handle('file.open', async ({ repoPath, file }) => {
    await assertRepo(repoPath);
    assertRel(file);
    const m = await showWorkspace(repoPath);
    if (!m) return { opened: false };
    await orca.host.call('editor.open', {
      workspaceId: m.ws.id,
      path: inWorkspace(m, file),
    });
    return { opened: true };
  });

  orca.panels.handle('file.diff', async ({ path, file, group }) => {
    await assertRepo(path);
    if (group === 'untracked') await assertInside(path, file);
    return cappedDiff(path, diffArgs(file, group));
  });

  /** Nome fisso: un solo tab "anteprima" per repo, riusato (e aggiornato) a ogni diff. */
  const PREVIEW = 'anteprima.gitdiff';
  const PREVIEW_DIR = '.orca-overview';

  /** Aggiunge `pattern` a `.git/info/exclude` (solo locale, mai versionato) se manca. */
  async function excludeFromGit(gitDir: string, pattern: string): Promise<void> {
    const file = join(gitDir, 'info', 'exclude');
    const current = await readFile(file, 'utf8').catch(() => '');
    if (current.split('\n').includes(pattern)) return;
    await mkdir(join(gitDir, 'info'), { recursive: true });
    await appendFile(
      file,
      `${current && !current.endsWith('\n') ? '\n' : ''}${pattern}\n`,
    );
  }

  /** Scrive il diff nel file di anteprima e lo apre nel tab centrale del workspace del repo. */
  async function showPreview(
    path: string,
    m: WsMatch,
    payload: Omit<DiffPayload, 'lang'>,
  ): Promise<{ opened: boolean; reason?: OpenFailure }> {
    const gitDir = join(path, '.git');
    if (!(await stat(gitDir)).isDirectory())
      return { opened: false, reason: 'git-not-dir' };
    // Fuori da `.git`: il watcher di Orca ignora quella cartella, quindi un tab già aperto
    // non vedrebbe le riscritture. La cartella è esclusa da git via `.git/info/exclude`.
    const dir = join(path, PREVIEW_DIR);
    await excludeFromGit(gitDir, `/${PREVIEW_DIR}/`);
    // Repo non fidato: `.orca-overview` versionata come symlink punterebbe fuori dal repo.
    const dirStat = await lstat(dir).catch(() => null);
    if (dirStat && (dirStat.isSymbolicLink() || !dirStat.isDirectory()))
      return { opened: false, reason: 'preview-dir-unsafe' };
    if (!dirStat) await mkdir(dir);
    const file = join(dir, PREVIEW);
    const fileStat = await lstat(file).catch(() => null);
    if (fileStat && !fileStat.isFile())
      return { opened: false, reason: 'preview-dir-unsafe' };
    // L'editor isolato non legge i setting: la lingua viaggia nel file.
    const lang = resolveLang(
      await orca.settings.get('language'),
      Intl.DateTimeFormat().resolvedOptions().locale,
    );
    // File temporaneo + rename: sostituisce la voce invece di seguire un eventuale symlink.
    const tmp = join(
      dir,
      `${PREVIEW}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
    );
    await writeFile(tmp, JSON.stringify({ ...payload, lang }), { flag: 'wx' });
    await rename(tmp, file);
    await orca.host.call('workspace.open', { workspaceId: m.ws.id });
    await orca.host.call('editor.open', {
      workspaceId: m.ws.id,
      path: inWorkspace(m, `${PREVIEW_DIR}/${PREVIEW}`),
    });
    return { opened: true };
  }

  orca.panels.handle(
    'file.diff.open',
    async ({ path, file, group, engine, hash, origFile }) => {
      await assertRepo(path);
      assertRel(file);
      const ws = await findWorkspace(path);
      if (!ws) return { opened: false, reason: 'no-workspace' as const };
      if (hash) {
        const { diff, truncated } = await cappedDiff(
          path,
          commitDiffArgs(hash, file, origFile),
        );
        return showPreview(path, ws, { title: hash.slice(0, 10), file, diff, truncated });
      }
      if (engine === 'native' && (await nativeDiff(path, file, group)) === 'ok')
        return { opened: true };
      if (group === 'untracked') await assertInside(path, file);
      const { diff, truncated } = await cappedDiff(path, diffArgs(file, group));
      return showPreview(path, ws, { title: group, file, diff, truncated });
    },
  );

  orca.panels.handle('repo.branches', async ({ path }) => {
    await assertRepo(path);
    const fmt =
      '%(refname)%09%(refname:short)%09%(upstream:short)%09%(upstream:track)%09%(committerdate:unix)%09%(HEAD)';
    const out = await git(path, [
      'for-each-ref',
      `--format=${fmt}`,
      '--sort=-committerdate',
      'refs/heads',
      'refs/remotes',
    ]);
    return { branches: parseBranches(out) };
  });

  orca.panels.handle('repo.switch', async ({ path, branch, remote }) => {
    // Mai --force/--discard-changes: se l'albero di lavoro confligge, git rifiuta e lo riportiamo.
    await assertRepo(path);
    const args = remote ? ['switch', '--track', '--', branch] : ['switch', '--', branch];
    try {
      await git(path, args);
      return {
        ok: true,
        message: (await translator())('switchedTo', {
          name: remote ? branch.replace(/^[^/]+\//, '') : branch,
        }),
      };
    } catch (e) {
      const err = e as { stderr?: string; message?: string };
      return {
        ok: false,
        message: (
          err.stderr ||
          err.message ||
          (await translator())('switchFailed')
        ).trim(),
      };
    }
  });

  orca.panels.handle('file.log', async ({ path, file }) => {
    await assertRepo(path);
    assertRel(file);
    const out = await git(
      path,
      [
        '-c',
        'core.quotepath=false',
        'log',
        '--follow',
        '--name-only',
        `-n${LOG_LIMIT + 1}`,
        '--format=%x01%h%x09%an%x09%ct%x09%s',
        '--',
        file,
      ],
      60_000,
    ).catch(() => '');
    const all = parseFileLog(out);
    return { commits: all.slice(0, LOG_LIMIT), truncated: all.length > LOG_LIMIT };
  });

  orca.panels.handle('repo.graph', async ({ path, limit: rawLimit, remotes, branch }) => {
    await assertRepo(path);
    const limit = clampLimit(rawLimit, 2000);
    const names = (await git(path, ['remote']).catch(() => ''))
      .split('\n')
      .filter(Boolean);
    // `HEAD` dopo le ref per includere anche un HEAD staccato; senza filtro: tutti i branch e i tag.
    // `--end-of-options`: un nome di branch che inizia con `-` non diventa mai un'opzione.
    const scope = branch
      ? ['--end-of-options', branch]
      : ['--branches', '--tags', ...(remotes ? ['--remotes'] : []), 'HEAD'];
    const [out, head] = await Promise.all([
      git(
        path,
        [
          'log',
          '--topo-order',
          `-n${limit + 1}`,
          '--format=%x01%H%x09%P%x09%an%x09%ct%x09%D%x09%s',
          ...scope,
          '--',
        ],
        60_000,
      ),
      git(path, ['rev-parse', 'HEAD']).catch(() => ''),
    ]);
    const all = parseGraphLog(out, names);
    return {
      commits: all.slice(0, limit),
      head: head.trim() || null,
      hasMore: all.length > limit,
    };
  });

  orca.panels.handle('commit.detail', async ({ path, hash }) => {
    await assertRepo(path);
    assertHash(hash);
    // -m --first-parent: per un merge mostra le differenze rispetto al primo genitore.
    const show = [
      '-c',
      'core.quotepath=false',
      'show',
      '--no-ext-diff',
      '--no-textconv',
      '-m',
      '--first-parent',
      '-M',
    ];
    const [out, num] = await Promise.all([
      git(path, [...show, '--name-status', '--format=%x01%B%x01', hash, '--']),
      git(path, [...show, '--numstat', '-z', '--format=', hash, '--']).catch(() => ''),
    ]);
    const [, body = '', files = ''] = out.split('\x01');
    const stats = parseNumstatZ(num);
    return {
      body: body.trim(),
      files: parseNameStatus(files).map((f) => {
        const s = stats.get(f.path);
        return s ? { ...f, added: s[0], deleted: s[1] } : f;
      }),
    };
  });

  orca.panels.handle('commit.diff', async ({ path, hash, file, origFile }) => {
    await assertRepo(path);
    return cappedDiff(path, commitDiffArgs(hash, file, origFile));
  });

  orca.panels.handle('repo.open', async ({ path }) => {
    await assertRepo(path);
    return { opened: (await showWorkspace(path)) !== null };
  });
}
