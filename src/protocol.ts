export {};

export interface RepoStatus {
  name: string;
  path: string;
  branch: string;
  detached: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  staged: number;
  unstaged: number;
  untracked: number;
  conflicts: number;
  stash: number;
  lastCommitAt: number | null;
  lastCommitSubject: string;
  error?: string;
}

/** Esito del fetch di un repo: `error` assente = riuscito. */
export interface FetchResult {
  name: string;
  error?: string;
}

/** Motivo per cui un'apertura nel workspace non è riuscita (il pannello lo traduce). */
export type OpenFailure = 'no-workspace' | 'git-not-dir' | 'preview-dir-unsafe';

export type FileGroup = 'staged' | 'unstaged' | 'untracked' | 'conflict';

/** File con stato e righe aggiunte/tolte (`null` = binario o sconosciuto). */
export interface FileEntry {
  path: string;
  origPath?: string;
  /** Lettera di stato git (M, A, D, R, C, T, ?, U). */
  code: string;
  added: number | null;
  deleted: number | null;
}

export interface ChangedFile extends FileEntry {
  group: FileGroup;
}

export interface Branch {
  /** Nome breve: `develop` oppure `origin/develop`. */
  name: string;
  remote: boolean;
  current: boolean;
  upstream: string | null;
  /** Esempio: `[ahead 1, behind 2]`. */
  track: string;
  at: number | null;
}

export interface Commit {
  hash: string;
  author: string;
  at: number;
  subject: string;
}

/** Commit che ha toccato un file; `path` è il nome del file in quel commit (rinomine incluse). */
export interface FileCommit extends Commit {
  path: string;
}

export interface GraphRef {
  name: string;
  kind: 'head' | 'remote' | 'tag';
  /** Branch su cui è HEAD. */
  current?: boolean;
}

export interface GraphCommit extends Commit {
  parents: string[];
  refs: GraphRef[];
}

declare module 'orca' {
  interface PluginRequests {
    'repos.list': {
      output: { root: string; source: string; repos: RepoStatus[]; tookMs: number };
    };
    'repo.files': {
      input: { path: string };
      output: { files: ChangedFile[]; total: number };
    };
    'file.open': {
      input: { repoPath: string; file: string };
      output: { opened: boolean };
    };
    /** Scrive su .git (refs remoti): solo su azione esplicita dell'utente. Un repo per richiesta. */
    'repo.fetch': {
      input: { path: string };
      output: { error?: string };
    };
    'file.diff': {
      input: { path: string; file: string; group: FileGroup };
      output: { diff: string; truncated: boolean };
    };
    /**
     * Scrive `.orca-overview/<nome-file>.gitdiff` (esclusa via `.git/info/exclude`; stesso nome file = tab riusato) e lo apre nel tab centrale.
     * Con `hash` mostra il diff del file in quel commit (`origFile` per le rinomine), altrimenti quello del working tree.
     */
    'file.diff.open': {
      input: {
        path: string;
        file: string;
        group: FileGroup;
        engine?: 'native' | 'plugin';
        hash?: string;
        origFile?: string;
      };
      output: { opened: boolean; reason?: OpenFailure };
    };
    'repo.branches': { input: { path: string }; output: { branches: Branch[] } };
    /** Scrive su .git (cambia il branch): solo su azione esplicita dell'utente. */
    'repo.switch': {
      input: { path: string; branch: string; remote: boolean };
      output: { ok: boolean; message: string };
    };
    'file.log': {
      input: { path: string; file: string };
      output: { commits: FileCommit[]; truncated: boolean };
    };
    'repo.graph': {
      input: { path: string; limit: number; remotes: boolean; branch?: string };
      output: { commits: GraphCommit[]; head: string | null; hasMore: boolean };
    };
    'commit.detail': {
      input: { path: string; hash: string };
      output: { body: string; files: FileEntry[] };
    };
    'commit.diff': {
      input: { path: string; hash: string; file: string; origFile?: string };
      output: { diff: string; truncated: boolean };
    };
    'repo.open': { input: { path: string }; output: { opened: boolean } };
  }
}
