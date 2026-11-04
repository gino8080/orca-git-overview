// Pannello HTML (DOM) di Git Overview: repo, modifiche con diff affiancato, branch, storico.
import { layoutGraph, renderGraphSvg, type GraphLayout } from '../shared/graph'
import { dateLocale, makeT, resolveLang, type Key, type Lang, type Translate } from '../shared/i18n'
import type { Branch, ChangedFile, FileCommit, FileEntry, FileGroup, GraphCommit, RepoStatus } from '../src/protocol'

declare const orca: {
  plugin: { request(name: string, input?: unknown, opts?: { timeoutMs?: number }): Promise<any> }
  on(event: string, handler: (payload: unknown) => unknown): unknown
  settings: { get(key: string): Promise<unknown> }
  storage: { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void> }
}

const req = <T = any>(name: string, input?: unknown, timeoutMs?: number): Promise<T> =>
  orca.plugin.request(name, input, timeoutMs ? { timeoutMs } : undefined)

// Lingua e traduttore: si impostano all'avvio dal setting `language`.
let lang: Lang = 'en'
let t: Translate = makeT(lang)

type Tab = 'changes' | 'branches' | 'graph'

interface GraphState {
  commits: GraphCommit[]
  head: string | null
  hasMore: boolean
  loading: boolean
  limit: number
  branch: string
  layout: GraphLayout | null
  layoutKey: string
  sel: string | null
  detail: { body: string; files: FileEntry[] } | null
  fileSel: FileEntry | null
  note: string
  /** Incrementato a ogni caricamento: scarta le risposte di caricamenti superati. */
  seq: number
}

const GRAPH_PAGE = 300
const MIN_PANE = 80
const UNCOMMITTED = 'UNCOMMITTED'
const GRAPH_MAX_WIDTH = 120
const GRAPH_ROW = 24

// ---- stato
const S = {
  repos: [] as RepoStatus[],
  root: '',
  source: '',
  tookMs: 0,
  failure: null as string | null,
  note: '',
  onlyDirty: false,
  tab: 'changes' as Tab,
  selected: null as string | null,
  files: [] as ChangedFile[],
  filesLoading: false,
  selFile: null as { path: string; group: FileGroup } | null,
  branches: [] as Branch[],
  target: null as Branch | null,
  switchNote: null as { ok: boolean; message: string } | null,
  graph: null as null | GraphState,
  graphRemotes: true,
  fileView: 'tree' as 'flat' | 'tree',
  hist: null as null | { file: string; commits: FileCommit[]; truncated: boolean; sel: string | null; note: string },
  /** Altezze (px) della lista del grafo e del dettaglio commit, regolabili dal divisore e salvate. */
  paneH: { list: 320, detail: 260 },
  closed: new Set<string>() // sezioni <details> cambiate dall'utente
}

const msg = (e: unknown): string => String((e as Error)?.message ?? e)

/** Motivo (codice del worker) per cui un'apertura non è riuscita, nella lingua corrente. */
const openFailure = (reason: string | undefined, path: string): string =>
  reason === 'git-not-dir' ? t('reasonGitNotDir') : reason === 'no-workspace' ? t('reasonNoWorkspace', { path }) : t('diffNotOpened')

/** `source` di repos.list: `workspace:NOME` oppure `setting`. */
const sourceLabel = (s: string): string => (s.startsWith('workspace:') ? t('sourceWorkspace', { name: s.slice(10) }) : t('sourceSetting'))
const dirtyCount = (r: RepoStatus): number => r.staged + r.unstaged + r.untracked + r.conflicts
const selectedRepo = (): RepoStatus | null => S.repos.find((r) => r.path === S.selected) ?? null

// ---- DOM helper
type Child = Node | string | null | false | undefined
function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = String(v)
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener)
    else if (v === true) el.setAttribute(k, '')
    else if (v !== false && v != null) el.setAttribute(k, String(v))
  }
  for (const c of children) if (c) el.append(c)
  return el
}

const btn = (label: string, onclick: () => void, cls = '', title?: string) =>
  h('button', { class: 'btn ' + cls, onclick, title }, label)

// Icone (tratti stile Lucide, ISC): un solo <path> per icona, costanti fidate.
const ICONS = {
  refresh: 'M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5',
  download: 'M12 3v12M7 10l5 5 5-5M5 21h14',
  external: 'M15 3h6v6M10 14L21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  tree: 'M3 3h6v5H3zM6 8v10M6 12h7M6 18h7M15 10h6v4h-6zM15 16h6v4h-6z',
  close: 'M18 6L6 18M6 6l12 12',
  split: 'M3 5h7v14H3zM14 5h7v14h-7z',
  expand: 'M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3',
  file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2'
} as const

/** Pulsante solo icona: il testo vive nel tooltip (`title`) e in `aria-label`. */
function iconBtn(name: keyof typeof ICONS, title: string, onclick: () => void, active = false): HTMLElement {
  const b = h('button', { class: 'btn ico-btn' + (active ? ' primary' : ''), title, 'aria-label': title, onclick })
  b.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${ICONS[name]}"/></svg>`
  return b
}

// ---- azioni
async function refresh(): Promise<void> {
  try {
    const a = await req('repos.list')
    S.repos = a.repos; S.root = a.root; S.source = a.source; S.tookMs = a.tookMs; S.failure = null
    if (S.selected && !S.repos.some((r) => r.path === S.selected)) resetDetail(null)
    else if (S.selected) {
      void loadFiles(S.selected)
      if (S.tab === 'graph' && S.graph) void loadGraph(S.selected, S.graph.limit)
    }
  } catch (e) {
    S.failure = msg(e)
  }
  render()
}

function resetDetail(path: string | null): void {
  S.selected = path
  S.files = []; S.selFile = null
  S.branches = []; S.target = null; S.switchNote = null; S.graph = null; S.hist = null
}

async function loadFiles(path: string): Promise<void> {
  S.filesLoading = true; render()
  try {
    const a = await req('repo.files', { path })
    if (S.selected === path) {
      S.files = a.files
      // il file selezionato non c'è più
      if (S.selFile && !a.files.some((f: ChangedFile) => f.path === S.selFile!.path && f.group === S.selFile!.group)) S.selFile = null
    }
  } catch (e) {
    S.failure = msg(e)
  }
  S.filesLoading = false; render()
}

async function select(path: string): Promise<void> {
  resetDetail(path); render()
  void loadFiles(path)
  if (S.tab === 'graph') void loadGraph(path)
  try {
    const b = await req('repo.branches', { path })
    if (S.selected === path) S.branches = b.branches
  } catch (e) {
    S.failure = msg(e)
  }
  render()
}

/** Carica (o ricarica) il grafo; `limit` commit dalla cima. Mantiene la selezione se il commit c'è ancora. */
async function loadGraph(path: string, limit = GRAPH_PAGE, branch = S.graph?.branch ?? ''): Promise<void> {
  // Un solo oggetto per repo: le risposte in volo di selectCommit confrontano l'identità di S.graph.
  const G: GraphState = S.graph ?? { commits: [], head: null, hasMore: false, loading: true, limit, branch, layout: null, layoutKey: '', sel: null, detail: null, fileSel: null, note: '', seq: 0 }
  G.loading = true; G.limit = limit; G.branch = branch
  if (!G.sel) G.note = ''
  const seq = ++G.seq
  S.graph = G; render()
  try {
    const a = await req('repo.graph', { path, limit, remotes: S.graphRemotes, ...(branch ? { branch } : {}) })
    if (S.graph !== G || G.seq !== seq) return
    G.commits = a.commits; G.head = a.head; G.hasMore = a.hasMore
    if (G.sel && !a.commits.some((c: GraphCommit) => c.hash === G.sel)) { G.sel = null; G.detail = null; G.fileSel = null }
  } catch (e) {
    if (S.graph === G && G.seq === seq) G.note = t('graphErr', { msg: msg(e) })
  }
  if (G.seq === seq) G.loading = false
  render()
}

async function selectCommit(repoPath: string, c: GraphCommit): Promise<void> {
  const G = S.graph
  if (!G) return
  G.sel = c.hash; G.detail = null; G.fileSel = null; G.note = t('loadingCommit'); render()
  try {
    const a = await req('commit.detail', { path: repoPath, hash: c.hash })
    if (S.graph === G && G.sel === c.hash) { G.detail = a; G.note = '' }
  } catch (e) {
    if (S.graph === G && G.sel === c.hash) G.note = t('commitErr', { msg: msg(e) })
  }
  render()
}

/** Apre il diff nel tab centrale "anteprima" del workspace del repo (un solo tab, riusato). */
async function previewDiff(repo: RepoStatus, input: { file: string; group: FileGroup; hash?: string; origFile?: string }): Promise<void> {
  S.note = t('openingDiff'); render()
  const r = await call(t('lblDiff'), 'file.diff.open', { path: repo.path, engine: 'plugin', ...input })
  if (r) { S.note = r.opened ? '' : openFailure(r.reason, repo.path); render() }
}

function showGraphFile(repo: RepoStatus, f: FileEntry): void {
  const G = S.graph
  if (!G?.sel) return
  G.fileSel = f
  void previewDiff(repo, { file: f.path, group: 'unstaged', hash: G.sel, ...(f.origPath ? { origFile: f.origPath } : {}) })
}

function showDiff(repo: RepoStatus, f: ChangedFile): void {
  S.selFile = { path: f.path, group: f.group }
  if (S.hist?.file !== f.path) S.hist = null
  void previewDiff(repo, { file: f.path, group: f.group })
}

async function loadHistory(repoPath: string, file: string): Promise<void> {
  S.hist = { file, commits: [], truncated: false, sel: null, note: t('loadingHistory') }; render()
  try {
    const a = await req('file.log', { path: repoPath, file })
    if (S.hist?.file !== file) return
    S.hist.commits = a.commits; S.hist.truncated = a.truncated
    S.hist.note = a.commits.length ? '' : t('noFileCommits')
  } catch (e) {
    if (S.hist?.file === file) S.hist.note = t('historyErr', { msg: msg(e) })
  }
  render()
}

function showCommitDiff(repo: RepoStatus, c: FileCommit): void {
  if (S.hist) S.hist.sel = c.hash
  void previewDiff(repo, { file: c.path, group: 'unstaged', hash: c.hash })
}

async function call(label: string, name: string, input: unknown, timeoutMs?: number): Promise<any> {
  try {
    return await req(name, input, timeoutMs)
  } catch (e) {
    S.note = `${label}: ${msg(e)}`; render()
    return null
  }
}

async function openDiff(repo: RepoStatus, f: ChangedFile, engine: 'native' | 'plugin'): Promise<void> {
  const r = await call(t('lblDiff'), 'file.diff.open', { path: repo.path, file: f.path, group: f.group, engine })
  if (r) { S.note = r.opened ? '' : openFailure(r.reason, repo.path); render() }
}

async function openFile(repo: RepoStatus, f: ChangedFile): Promise<void> {
  const r = await call(t('lblOpenFile'), 'file.open', { repoPath: repo.path, file: f.path })
  if (r) { S.note = r.opened ? '' : t('reasonNoWorkspace', { path: repo.path }); render() }
}

async function openRepo(repo: RepoStatus): Promise<void> {
  const r = await call(t('lblOpenWorkspace'), 'repo.open', { path: repo.path })
  if (r) { S.note = r.opened ? '' : t('reasonNoWorkspace', { path: repo.path }); render() }
}

async function fetchAll(): Promise<void> {
  S.note = t('fetchRunning'); render()
  const r = await call('Fetch', 'repos.fetch', undefined, 120000)
  if (r) S.note = r.failed.length ? t('fetchFailed', { repos: r.failed.join(', ') }) : t('fetchOk', { ms: r.tookMs })
  await refresh()
}

async function doSwitch(repo: RepoStatus, b: Branch): Promise<void> {
  S.switchNote = { ok: true, message: t('switchRunning') }; render()
  const r = await call('Switch', 'repo.switch', { path: repo.path, branch: b.name, remote: b.remote })
  if (!r) return
  S.switchNote = r
  if (r.ok) {
    S.target = null
    await refresh()
    await select(repo.path)
    S.switchNote = r // select() riparte da zero e azzera la nota
  }
  render()
}

// ---- viste
function describe(r: RepoStatus): string {
  if (r.error) return t('errorPrefix', { msg: r.error.split('\n')[0] })
  const parts = [r.branch]
  if (dirtyCount(r)) parts.push(`${r.staged}S ${r.unstaged}M ${r.untracked}?` + (r.conflicts ? ` ${r.conflicts}!` : ''))
  if (r.ahead || r.behind) parts.push(`↑${r.ahead} ↓${r.behind}`)
  if (!r.upstream && !r.detached) parts.push(t('noUpstream'))
  if (r.stash) parts.push(`stash ${r.stash}`)
  return parts.join(' · ')
}

const GROUPS: { group: FileGroup; title: Key }[] = [
  { group: 'conflict', title: 'groupConflicts' },
  { group: 'staged', title: 'groupStaged' },
  { group: 'unstaged', title: 'groupChanges' },
  { group: 'untracked', title: 'groupUntracked' }
]

/** Sezione richiudibile; `S.closed` ricorda le scelte dell'utente tra un render e l'altro. */
function section(key: string, title: string, content: Node, openByDefault = true): HTMLElement {
  const toggled = S.closed.has(key)
  const d = h('details', { open: openByDefault !== toggled }, h('summary', {}, title), content)
  d.addEventListener('toggle', () => {
    if (d.open !== openByDefault) S.closed.add(key)
    else S.closed.delete(key)
  })
  return d
}

function viewRepos(): HTMLElement {
  const shown = (S.onlyDirty ? S.repos.filter((r) => dirtyCount(r) > 0) : S.repos)
    .slice()
    .sort((a, b) => dirtyCount(b) - dirtyCount(a) || a.name.localeCompare(b.name))
  if (shown.length === 0) return h('div', { class: 'muted' }, t('noRepos'))
  return h('div', { class: 'list' }, ...shown.map((r) =>
    h('div', { class: 'item' + (r.path === S.selected ? ' cur' : ''), onclick: () => void select(r.path) },
      h('div', { class: 'title' }, r.name),
      h('div', { class: 'desc' }, describe(r)))))
}

/** Azioni sul file selezionato: il diff vive nel tab centrale, qui restano i comandi. */
function viewFileActions(repo: RepoStatus, f: ChangedFile): HTMLElement {
  const box = h('div', { class: 'diffbox' })
  box.append(
    h('div', { class: 'row between' },
      h('b', { class: 'trunc' }, f.path),
      h('span', { class: 'row' },
        iconBtn('expand', t('tipPreview'), () => showDiff(repo, f)),
        iconBtn('split', t('tipNativeDiff'), () => void openDiff(repo, f, 'native')),
        iconBtn('file', t('tipOpenFile'), () => void openFile(repo, f)))))
  if (f.group !== 'untracked') box.append(viewHistory(repo, f))
  return box
}

function viewHistory(repo: RepoStatus, f: ChangedFile): HTMLElement {
  const H = S.hist
  const box = h('div', { class: 'diffbox' })
  if (!H || H.file !== f.path) return h('div', {}, iconBtn('history', t('tipHistory'), () => void loadHistory(repo.path, f.path)))
  box.append(h('div', { class: 'row between' }, h('b', { class: 'trunc' }, t('historyOf', { file: f.path })), iconBtn('close', t('tipCloseHistory'), () => { S.hist = null; render() })))
  if (H.note) box.append(h('div', { class: 'muted' }, H.note))
  if (H.commits.length) {
    box.append(h('div', { class: 'list histlist' }, ...H.commits.map((c) =>
      h('div', { class: 'item' + (c.hash === H.sel ? ' cur' : ''), onclick: () => showCommitDiff(repo, c) },
        h('div', { class: 'title' }, c.subject),
        h('div', { class: 'desc' }, `${c.hash} · ${c.author} · ${new Date(c.at).toLocaleDateString()}` + (c.path !== f.path ? ` · ${c.path}` : ''))))))
    if (H.truncated) box.append(h('div', { class: 'muted' }, t('first200')))
  }
  return box
}

function viewChanges(repo: RepoStatus): HTMLElement {
  const root = h('div', { class: 'stack' })
  if (S.filesLoading && S.files.length === 0) root.append(h('div', { class: 'muted' }, t('loading')))
  else if (S.files.length === 0) root.append(h('div', { class: 'muted' }, t('noChanges')))
  else root.append(h('div', { class: 'row between' }, h('b', {}, t('nFiles', { n: S.files.length })), fileViewToggle()))
  for (const { group, title } of GROUPS) {
    const items = S.files.filter((f) => f.group === group)
    if (items.length === 0) continue
    root.append(section('g:' + group, `${t(title)} (${items.length})`, fileList(items, `${repo.path}:${group}`,
      (f) => !!S.selFile && S.selFile.path === f.path && S.selFile.group === f.group, (f) => showDiff(repo, f))))
  }
  if (S.selFile) {
    const f = S.files.find((x) => x.path === S.selFile!.path && x.group === S.selFile!.group)
    if (f) root.append(viewFileActions(repo, f))
  }
  return root
}

function branchItem(b: Branch): HTMLElement {
  const tg = S.target
  const cur = b.current || (!!tg && tg.name === b.name && tg.remote === b.remote)
  return h('div', { class: 'item' + (cur ? ' cur' : ''), onclick: () => { S.target = b.current ? null : b; render() } },
    h('div', { class: 'title' }, b.name),
    h('div', { class: 'desc' }, [b.current ? t('current') : '', b.track].filter(Boolean).join(' · ')))
}

function viewBranches(repo: RepoStatus): HTMLElement {
  const local = S.branches.filter((b) => !b.remote)
  const remote = S.branches.filter((b) => b.remote)
  const tg = S.target
  return h('div', { class: 'stack' },
    S.switchNote && h('div', { class: 'note ' + (S.switchNote.ok ? 'ok' : 'err') }, S.switchNote.message),
    tg && h('div', { class: 'row between confirm' }, h('span', {}, t('switchTo', { name: tg.name })),
      h('span', { class: 'row' }, btn('Switch', () => void doSwitch(repo, tg), 'primary'), btn(t('cancel'), () => { S.target = null; render() }))),
    section('b:local', t('localBranches', { n: local.length }), h('div', { class: 'list' }, ...local.map(branchItem))),
    section('b:remote', t('remoteBranches', { n: remote.length }), h('div', { class: 'list' }, ...remote.map(branchItem)), false),
    h('div', { class: 'muted' }, t('remotesHint')))
}

const fmtDate = (ms: number): string =>
  new Date(ms).toLocaleString(dateLocale(lang), { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

function refChip(r: GraphCommit['refs'][number]): HTMLElement {
  return h('span', { class: `ref ${r.kind}` + (r.current ? ' cur' : '') }, r.name)
}

function viewGraph(repo: RepoStatus): HTMLElement {
  const G = S.graph
  const root = h('div', { class: 'stack' })
  if (!G) { root.append(h('div', { class: 'muted' }, t('loading'))); return root }
  const locals = S.branches.filter((b) => !b.remote)
  root.append(h('div', { class: 'row between' },
    h('span', { class: 'row' },
      h('select', { class: 'btn', title: t('tipBranchSel'), onchange: (e: Event) => void loadGraph(repo.path, G.limit, (e.target as HTMLSelectElement).value) },
        h('option', { value: '', selected: !G.branch }, t('allBranches')),
        ...locals.map((b) => h('option', { value: b.name, selected: G.branch === b.name }, b.name))),
      h('label', { class: 'row' },
        h('input', { type: 'checkbox', checked: S.graphRemotes, onchange: (e: Event) => { S.graphRemotes = (e.target as HTMLInputElement).checked; void orca.storage.set('graphRemotes', S.graphRemotes); void loadGraph(repo.path, G.limit) } }),
        t('remotesLabel'))),
    G.loading && h('span', { class: 'muted' }, t('loading'))))
  if (G.note && !G.sel) root.append(h('div', { class: 'note warn' }, G.note))

  // Righe: opzionale "modifiche non committate" in testa, poi i commit.
  const dirty = dirtyCount(repo) > 0 && !G.branch && G.head !== null
  const rows: { hash: string; parents: string[]; uncommitted?: boolean }[] = G.commits.map((c) => ({ hash: c.hash, parents: c.parents }))
  if (dirty) rows.unshift({ hash: UNCOMMITTED, parents: [G.head!], uncommitted: true })
  // Tutti gli hash: lo stesso numero di commit con la stessa cima può avere una storia diversa (rebase, amend).
  const key = `${G.commits.map((c) => c.hash).join(',')}|${G.head}|${dirty}`
  if (G.layoutKey !== key || !G.layout) { G.layout = layoutGraph(rows, G.head); G.layoutKey = key }
  const gw = Math.min(G.layout.width, GRAPH_MAX_WIDTH)

  const svgBox = h('div', { class: 'gsvg', style: `width:${gw}px;height:${G.layout.height}px` }, renderGraphSvg(G.layout) as unknown as Node)
  const line = (children: Child[], cls: string, onclick: () => void, title: string) =>
    h('div', { class: 'grow ' + cls, style: `height:${GRAPH_ROW}px;padding-left:${gw + 8}px`, title, onclick }, ...children)
  const items: HTMLElement[] = []
  if (dirty) {
    items.push(line([h('span', { class: 'gsub' }, t('uncommitted')), h('span', { class: 'gmeta' }, t('nFiles', { n: dirtyCount(repo) }))], 'unc',
      () => { S.tab = 'changes'; void orca.storage.set('tab', 'changes'); render() }, t('tipOpenChanges')))
  }
  for (const c of G.commits) {
    items.push(line(
      [...c.refs.map(refChip), h('span', { class: 'gsub' }, c.subject),
        h('span', { class: 'gmeta' }, c.author), h('span', { class: 'gmeta' }, fmtDate(c.at)), h('span', { class: 'gmeta mono' }, c.hash.slice(0, 7))],
      G.sel === c.hash ? 'cur' : '', () => void selectCommit(repo.path, c), `${c.hash.slice(0, 7)} · ${c.author} · ${fmtDate(c.at)}`))
  }
  const list = h('div', { class: 'gscroll', style: `height:${S.paneH.list}px` }, h('div', { class: 'ginner' }, svgBox, ...items))
  root.append(list)
  if (G.hasMore) root.append(btn(t('loadMore', { n: GRAPH_PAGE }), () => void loadGraph(repo.path, G.limit + GRAPH_PAGE)))
  if (G.sel) {
    const detail = h('div', { class: 'gdetail', style: `height:${S.paneH.detail}px` }, viewCommitDetail(repo, G))
    root.append(splitter(list, detail), detail)
  }
  return root
}

function setFileView(v: 'flat' | 'tree'): void {
  S.fileView = v
  void orca.storage.set('fileView', v)
  render()
}

interface TreeNode<T> { name: string; dirs: Map<string, TreeNode<T>>; files: T[] }

function buildTree<T extends FileEntry>(files: T[]): TreeNode<T> {
  const root: TreeNode<T> = { name: '', dirs: new Map(), files: [] }
  for (const f of files) {
    let node = root
    for (const part of f.path.split('/').slice(0, -1)) {
      if (!node.dirs.has(part)) node.dirs.set(part, { name: part, dirs: new Map(), files: [] })
      node = node.dirs.get(part)!
    }
    node.files.push(f)
  }
  return root
}

const countFiles = <T,>(n: TreeNode<T>): number => n.files.length + [...n.dirs.values()].reduce((s, d) => s + countFiles(d), 0)

/** Cartelle richiudibili (catene di cartelle con un solo figlio fuse: `src/a/b`), poi i file. */
function treeNodes<T extends FileEntry>(node: TreeNode<T>, scope: string, row: (f: T, tree: boolean) => HTMLElement, prefix = ''): Node[] {
  const out: Node[] = []
  for (const d of [...node.dirs.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    let cur = d
    let name = d.name
    while (cur.files.length === 0 && cur.dirs.size === 1) {
      cur = [...cur.dirs.values()][0]
      name += '/' + cur.name
    }
    const path = `${prefix}${name}/`
    out.push(section(`t:${scope}:${path}`, `${name} (${countFiles(cur)})`, h('div', { class: 'tree' }, ...treeNodes(cur, scope, row, path))))
  }
  out.push(...node.files.map((f) => row(f, true)))
  return out
}

const statNum = (n: number | null, cls: string, sign: string): Child => n !== null && n > 0 && h('span', { class: cls }, `${sign}${n}`)

/** Riga di un file: lettera di stato colorata, nome, cartella (solo in lista piatta), righe +/-. */
function fileRow(f: FileEntry, tree: boolean, selected: boolean, onclick: () => void): HTMLElement {
  const i = f.path.lastIndexOf('/')
  const desc = (tree ? '' : i >= 0 ? f.path.slice(0, i) : '.') + (f.origPath ? ` ← ${f.origPath}` : '')
  return h('div', { class: 'item' + (selected ? ' cur' : ''), onclick },
    h('div', { class: 'title frow' },
      h('span', { class: `code st-${f.code === '?' ? 'q' : f.code}`, title: STATUS_KEY[f.code] ? t(STATUS_KEY[f.code]) : f.code }, f.code),
      h('span', { class: 'fname' }, f.path.slice(i + 1)),
      statNum(f.added, 'add', '+'), statNum(f.deleted, 'del', '-')),
    desc && h('div', { class: 'desc' }, desc))
}

const STATUS_KEY: Record<string, Key> = { M: 'stM', A: 'stA', D: 'stD', R: 'stR', C: 'stC', T: 'stT', U: 'stU', '?': 'stQ' }

/** Elenco di file in lista piatta o ad albero, secondo `S.fileView`. */
function fileList<T extends FileEntry>(files: T[], scope: string, isSelected: (f: T) => boolean, onSelect: (f: T) => void): HTMLElement {
  const row = (f: T, tree: boolean) => fileRow(f, tree, isSelected(f), () => onSelect(f))
  return h('div', { class: 'list' }, ...(S.fileView === 'tree' ? treeNodes(buildTree(files), scope, row) : files.map((f) => row(f, false))))
}

function fileViewToggle(): HTMLElement {
  return h('span', { class: 'row' },
    iconBtn('list', t('tipFlat'), () => setFileView('flat'), S.fileView === 'flat'),
    iconBtn('tree', t('tipTree'), () => setFileView('tree'), S.fileView === 'tree'))
}

function viewCommitDetail(repo: RepoStatus, G: GraphState): HTMLElement {
  const c = G.commits.find((x) => x.hash === G.sel)
  const box = h('div', { class: 'diffbox' })
  if (!c) return box
  box.append(
    h('div', { class: 'row between' }, h('b', {}, c.hash.slice(0, 10)), iconBtn('close', t('tipCloseDetail'), () => { G.sel = null; G.detail = null; G.fileSel = null; render() })),
    h('div', { class: 'muted' }, `${c.author} · ${fmtDate(c.at)}`))
  if (c.refs.length) box.append(h('div', { class: 'row wrap' }, ...c.refs.map(refChip)))
  if (G.note) box.append(h('div', { class: 'muted' }, G.note))
  if (G.detail) {
    // Messaggio compresso: la prima riga è l'intestazione, il resto si apre a richiesta.
    const [first, ...rest] = G.detail.body.split('\n')
    box.append(rest.some((l) => l.trim())
      ? section('cmsg', first, h('pre', { class: 'cmsg' }, rest.join('\n').trim()), false)
      : h('div', { class: 'cmsg-one' }, first))
    const files = G.detail.files
    box.append(
      h('div', { class: 'row between' }, h('b', {}, t('nFiles', { n: files.length })), fileViewToggle()),
      fileList(files, `c:${G.sel}`, (f) => G.fileSel === f, (f) => showGraphFile(repo, f)))
  }
  return box
}

/** Divisore trascinabile: sposta altezza tra lista e dettaglio (somma costante); salva al rilascio. */
function splitter(list: HTMLElement, detail: HTMLElement): HTMLElement {
  const bar = h('div', { class: 'vsplit', title: t('tipSplitter') })
  bar.addEventListener('pointerdown', (ev) => {
    ev.preventDefault()
    bar.setPointerCapture(ev.pointerId)
    const y0 = ev.clientY
    const { list: l0, detail: d0 } = S.paneH
    const move = (e: PointerEvent) => {
      const dy = Math.max(MIN_PANE - l0, Math.min(e.clientY - y0, d0 - MIN_PANE))
      S.paneH = { list: l0 + dy, detail: d0 - dy }
      list.style.height = `${S.paneH.list}px`
      detail.style.height = `${S.paneH.detail}px`
    }
    const end = () => {
      bar.removeEventListener('pointermove', move)
      bar.removeEventListener('pointerup', end)
      bar.removeEventListener('pointercancel', end)
      void orca.storage.set('paneH', S.paneH)
    }
    bar.addEventListener('pointermove', move)
    bar.addEventListener('pointerup', end)
    bar.addEventListener('pointercancel', end)
  })
  return bar
}

function viewDetail(): HTMLElement {
  const repo = selectedRepo()
  if (!repo) return h('div', { class: 'muted' }, t('pickRepo'))
  const tabs: [Tab, string][] = [['changes', t('tabChanges')], ['branches', t('tabBranches')], ['graph', t('tabGraph')]]
  return h('div', { class: 'stack' },
    h('div', { class: 'row between' }, h('b', {}, repo.name), iconBtn('external', t('tipOpenWorkspace'), () => void openRepo(repo))),
    h('div', { class: 'tabs' }, ...tabs.map(([id, label]) =>
      h('button', { class: 'tab' + (S.tab === id ? ' on' : ''), onclick: () => {
        S.tab = id; void orca.storage.set('tab', id)
        if (id === 'graph' && !S.graph) void loadGraph(repo.path)
        render()
      } }, label))),
    S.tab === 'changes' ? viewChanges(repo) : S.tab === 'branches' ? viewBranches(repo) : viewGraph(repo))
}

const app = h('div', { id: 'app' })
document.body.append(app)

function render(): void {
  hideTip()
  const scroll = document.scrollingElement?.scrollTop ?? 0
  const parts: Child[] = [
    h('div', { class: 'row between' },
      h('span', { class: 'row' }, iconBtn('refresh', t('tipRefresh'), () => void refresh()), iconBtn('download', t('tipFetch'), () => void fetchAll())),
      h('span', { class: 'badge' }, t('nRepos', { n: S.repos.length, ms: S.tookMs }))),
    h('label', { class: 'row' },
      h('input', { type: 'checkbox', checked: S.onlyDirty, onchange: (e: Event) => { S.onlyDirty = (e.target as HTMLInputElement).checked; void orca.storage.set('onlyDirty', S.onlyDirty); render() } }),
      t('onlyDirty')),
    S.failure && h('div', { class: 'note err' }, S.failure),
    S.note && h('div', { class: 'note warn' }, S.note),
    viewRepos(),
    h('div', { class: 'muted' }, `${S.root} (${sourceLabel(S.source)})`),
    h('hr'),
    viewDetail()
  ]
  app.replaceChildren(...parts.filter((c): c is Node => !!c))
  if (document.scrollingElement) document.scrollingElement.scrollTop = scroll
}

// Tooltip proprio: il `title` nativo non compare nel pannello di Orca. Delega su qualunque [title].
const tip = h('div', { class: 'tip' })
document.body.append(tip)
let tipTimer: number | undefined
function hideTip(): void {
  clearTimeout(tipTimer)
  tip.style.display = 'none'
}
document.addEventListener('mouseover', (e) => {
  const el = (e.target as Element).closest?.('[title],[data-tip]') as HTMLElement | null
  hideTip()
  if (!el) return
  const text = el.getAttribute('title')
  if (text) { el.dataset.tip = text; el.removeAttribute('title') } // evita il doppio tooltip nativo
  if (!el.dataset.tip) return
  tipTimer = window.setTimeout(() => {
    tip.textContent = el.dataset.tip ?? ''
    tip.style.display = 'block'
    const r = el.getBoundingClientRect()
    const w = tip.offsetWidth
    tip.style.left = `${Math.max(4, Math.min(r.left, window.innerWidth - w - 4))}px`
    tip.style.top = `${r.bottom + 6 + tip.offsetHeight > window.innerHeight ? Math.max(4, r.top - 6 - tip.offsetHeight) : r.bottom + 6}px`
  }, 350)
})
document.addEventListener('mouseout', hideTip)
document.addEventListener('pointerdown', hideTip)

const STYLE = `
.tip { display:none; position:fixed; z-index:1000; max-width:260px; padding:4px 8px; border-radius:5px; font-size:12px; line-height:1.35;
  pointer-events:none; color:var(--orca-foreground); background:var(--orca-background); border:1px solid rgba(128,128,128,.5); box-shadow:0 2px 8px rgba(0,0,0,.4) }
body { margin:0; padding:10px; font:13px system-ui, sans-serif; color:var(--orca-foreground); background:var(--orca-background); }
#app { display:flex; flex-direction:column; gap:8px; }
.row { display:flex; gap:6px; align-items:center } .between { justify-content:space-between }
.stack { display:flex; flex-direction:column; gap:8px }
.muted { opacity:.65; font-size:12px } .trunc { overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
hr { width:100%; border:0; border-top:1px solid rgba(128,128,128,.3); margin:2px 0 }
.btn { font:inherit; font-size:12px; padding:3px 9px; border-radius:5px; cursor:pointer; color:inherit;
  background:rgba(128,128,128,.15); border:1px solid rgba(128,128,128,.35) }
.ico-btn { display:inline-flex; align-items:center; justify-content:center; padding:4px 6px } .ico-btn svg { display:block }
.btn:hover { background:rgba(128,128,128,.28) } .btn.primary { background:#2f6feb; border-color:#2f6feb; color:#fff }
.badge { font-size:11px; padding:1px 8px; border-radius:10px; background:rgba(128,128,128,.2) }
.list { display:flex; flex-direction:column }
.item { padding:4px 8px; border-radius:5px; cursor:pointer } .item:hover { background:rgba(128,128,128,.14) }
.item.cur { background:rgba(128,128,128,.28) }
.title { font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
.desc { font-size:11.5px; opacity:.65; overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
.code { display:inline-block; flex:none; width:16px; text-align:center; font:700 11px ui-monospace,monospace; border-radius:3px; padding:1px 0 }
.st-M { color:#e2c08d; background:rgba(226,192,141,.15) } .st-A, .st-q { color:#73c991; background:rgba(115,201,145,.15) }
.st-D { color:#f0705f; background:rgba(240,112,95,.15) } .st-R, .st-C { color:#6cb6ff; background:rgba(108,182,255,.15) }
.st-U { color:#ff9f43; background:rgba(255,159,67,.2) } .st-T { color:#b392f0; background:rgba(179,146,240,.15) }
.frow { display:flex; align-items:center; gap:6px } .fname { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis }
.add, .del { flex:none; font:11px ui-monospace,monospace } .add { color:#73c991 } .del { color:#f0705f }
summary { cursor:pointer; font-weight:600; padding:2px 0 }
.tabs { display:flex; border-bottom:1px solid rgba(128,128,128,.3) }
.tab { font:inherit; background:none; border:0; color:inherit; opacity:.65; padding:5px 10px; cursor:pointer; border-bottom:2px solid transparent }
.tab.on { opacity:1; border-bottom-color:#2f6feb }
.note { padding:6px 8px; border-radius:5px; font-size:12px; white-space:pre-wrap }
.note.err { background:rgba(248,81,73,.2) } .note.warn { background:rgba(210,153,34,.2) } .note.ok { background:rgba(63,185,80,.2) }
.confirm { padding:6px 8px; border-radius:5px; background:rgba(128,128,128,.15) }
.diffbox { display:flex; flex-direction:column; gap:6px; margin-top:4px }
.row.wrap { flex-wrap:wrap }
.vsplit { height:6px; margin:-2px 0; cursor:row-resize; border-radius:3px; background:rgba(128,128,128,.25); flex:none; touch-action:none }
.vsplit:hover { background:#2f6feb }
.gdetail { overflow:auto; flex:none }
.cmsg-one { font-size:12px; opacity:.9 }
.gscroll { overflow:auto; flex:none; container-type:inline-size; border:1px solid rgba(128,128,128,.25); border-radius:5px }
.ginner { position:relative }
.gsvg { position:absolute; left:0; top:0; overflow:hidden; pointer-events:none }
.grow { display:flex; align-items:center; gap:6px; box-sizing:border-box; padding-right:8px; cursor:pointer; white-space:nowrap }
.grow:hover { background:rgba(128,128,128,.14) } .grow.cur { background:rgba(128,128,128,.28) }
.gsub { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis } .grow.unc .gsub { font-style:italic; opacity:.8 }
.gmeta { display:none; font-size:11.5px; opacity:.65 } .gmeta.mono { font-family:ui-monospace,monospace }
@container (min-width: 560px) { .gmeta { display:inline } }
.ref { font-size:11px; padding:0 6px; border-radius:9px; background:rgba(128,128,128,.25); max-width:180px; overflow:hidden; text-overflow:ellipsis; flex:none }
.ref.head { background:rgba(47,111,235,.35) } .ref.tag { background:rgba(210,153,34,.35) } .ref.cur { font-weight:700 }
.tree { margin-left:10px; padding-left:6px; border-left:1px solid rgba(128,128,128,.25) }
.cmsg { margin:0; white-space:pre-wrap; font:12px ui-monospace,monospace; opacity:.9 }
.histlist { max-height:30vh; overflow:auto }
`
document.head.append(h('style', {}, STYLE))

// avvio: preferenze salvate, primo caricamento, eventi, auto-refresh
void (async () => {
  S.onlyDirty = (await orca.storage.get('onlyDirty')) === true
  const savedTab = await orca.storage.get('tab')
  if (savedTab === 'changes' || savedTab === 'branches' || savedTab === 'graph') S.tab = savedTab
  S.graphRemotes = (await orca.storage.get('graphRemotes')) !== false
  S.fileView = (await orca.storage.get('fileView')) === 'flat' ? 'flat' : 'tree'
  lang = resolveLang(await orca.settings.get('language'), navigator.language)
  t = makeT(lang)
  const ph = (await orca.storage.get('paneH')) as { list?: unknown; detail?: unknown } | null
  if (typeof ph?.list === 'number' && typeof ph.detail === 'number') {
    S.paneH = { list: Math.max(MIN_PANE, ph.list), detail: Math.max(MIN_PANE, ph.detail) }
  }
  render()
  void refresh()
  orca.on('workspace.changed', () => void refresh())
  const sec = await orca.settings.get('refreshSeconds')
  if (typeof sec === 'number' && sec > 0) setInterval(() => void refresh(), sec * 1000)
})()
