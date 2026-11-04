// Stringhe dell'interfaccia in inglese e italiano. Orca non offre un'API di traduzione per i plugin:
// la lingua si sceglie con il setting `language` (auto = lingua del sistema).
// `it` è tipizzato su `typeof en`: una chiave mancante è un errore di compilazione.

const en = {
  // worker -> motivi del rifiuto di un'apertura
  reasonNoWorkspace: 'No Orca workspace registered for {path}',
  reasonGitNotDir: '.git is not a directory (linked worktree?)',
  sourceWorkspace: 'active workspace: {name}',
  sourceSetting: 'rootDir setting',
  // generali
  loading: 'Loading...',
  cancel: 'Cancel',
  errorPrefix: 'error: {msg}',
  nFiles: '{n} files',
  nRepos: '{n} repos · {ms} ms',
  noRepos: 'No repositories. Check the container folder in the plugin settings.',
  pickRepo: 'Select a repo to see changes, branches and history.',
  onlyDirty: 'Only with changes',
  tipRefresh: 'Refresh',
  tipFetch: 'Fetch: git fetch on all repos (writes remote refs)',
  tipOpenWorkspace: 'Open the repo workspace',
  // azioni e messaggi
  lblDiff: 'Diff',
  lblOpenFile: 'Open file',
  lblOpenWorkspace: 'Open workspace',
  openingDiff: 'Opening diff...',
  diffNotOpened: 'Diff not opened',
  fetchRunning: 'Fetch in progress...',
  fetchFailed: 'Fetch failed: {repos}',
  fetchOk: 'Fetch ok in {ms} ms',
  switchRunning: 'Switching...',
  switchedTo: 'Now on {name}',
  switchFailed: 'switch failed',
  // schede
  tabChanges: 'Changes',
  tabBranches: 'Branches',
  tabGraph: 'Graph',
  // modifiche
  groupConflicts: 'Conflicts',
  groupStaged: 'Staged',
  groupChanges: 'Changes',
  groupUntracked: 'Untracked',
  noChanges: 'No changes.',
  noUpstream: 'no upstream',
  tipPreview: 'Diff in the central tab (preview)',
  tipNativeDiff: "Native diff: Orca's diff view in a tab",
  tipOpenFile: 'Open file',
  tipFlat: 'Flat list',
  tipTree: 'Tree by folder',
  stM: 'Modified',
  stA: 'Added',
  stD: 'Deleted',
  stR: 'Renamed',
  stC: 'Copied',
  stT: 'Type changed',
  stU: 'Conflict',
  stQ: 'Untracked',
  // storico file
  tipHistory: 'File history: commits that touched this file (follows renames)',
  tipCloseHistory: 'Close history',
  historyOf: 'History of {file}',
  loadingHistory: 'Loading history...',
  noFileCommits: 'No commits for this file.',
  historyErr: 'History: {msg}',
  first200: 'Showing the first 200 commits',
  // branch
  current: 'current',
  switchTo: 'Switch to {name}?',
  localBranches: 'Local ({n})',
  remoteBranches: 'Remote ({n})',
  remotesHint: 'Remotes are the ones already known locally: use Fetch to update them.',
  // grafo
  tipBranchSel: 'Branch to show',
  allBranches: 'All branches',
  remotesLabel: 'Remotes',
  uncommitted: 'Uncommitted changes',
  tipOpenChanges: 'Open the Changes tab',
  loadMore: 'Load {n} more',
  loadingCommit: 'Loading commit...',
  graphErr: 'Graph: {msg}',
  commitErr: 'Commit: {msg}',
  tipCloseDetail: 'Close detail',
  tipSplitter: 'Drag to resize list and detail',
  // editor diff
  diffInvalid: 'Invalid file',
  diffBinary: 'Binary file: no text diff.',
  diffNone: 'No textual differences.',
  diffFold: '··· {n} unchanged lines ···'
}

export type Key = keyof typeof en
export type Lang = 'en' | 'it'

const it: Record<Key, string> = {
  reasonNoWorkspace: 'Nessun workspace Orca registrato per {path}',
  reasonGitNotDir: '.git non è una cartella (worktree collegato?)',
  sourceWorkspace: 'workspace attivo: {name}',
  sourceSetting: 'setting rootDir',
  loading: 'Carico...',
  cancel: 'Annulla',
  errorPrefix: 'errore: {msg}',
  nFiles: '{n} file',
  nRepos: '{n} repo · {ms} ms',
  noRepos: 'Nessun repo. Controlla la cartella nei setting del plugin.',
  pickRepo: 'Seleziona un repo per vedere modifiche, branch e storico.',
  onlyDirty: 'Solo con modifiche',
  tipRefresh: 'Aggiorna',
  tipFetch: 'Fetch: git fetch su tutti i repo (scrive i riferimenti remoti)',
  tipOpenWorkspace: 'Apri il workspace del repo',
  lblDiff: 'Diff',
  lblOpenFile: 'Apri file',
  lblOpenWorkspace: 'Apri workspace',
  openingDiff: 'Apro il diff...',
  diffNotOpened: 'Diff non aperto',
  fetchRunning: 'Fetch in corso...',
  fetchFailed: 'Fetch fallito: {repos}',
  fetchOk: 'Fetch ok in {ms} ms',
  switchRunning: 'Switch in corso...',
  switchedTo: 'Ora su {name}',
  switchFailed: 'switch fallito',
  tabChanges: 'Modifiche',
  tabBranches: 'Branch',
  tabGraph: 'Grafo',
  groupConflicts: 'Conflitti',
  groupStaged: 'Staged',
  groupChanges: 'Modifiche',
  groupUntracked: 'Non tracciati',
  noChanges: 'Nessuna modifica.',
  noUpstream: 'no upstream',
  tipPreview: 'Diff nel tab centrale (anteprima)',
  tipNativeDiff: 'Diff nativo: vista diff di Orca in un tab',
  tipOpenFile: 'Apri file',
  tipFlat: 'Lista piatta',
  tipTree: 'Albero per cartella',
  stM: 'Modificato',
  stA: 'Aggiunto',
  stD: 'Eliminato',
  stR: 'Rinominato',
  stC: 'Copiato',
  stT: 'Tipo cambiato',
  stU: 'Conflitto',
  stQ: 'Non tracciato',
  tipHistory: 'Storico file: commit che hanno toccato questo file (segue le rinomine)',
  tipCloseHistory: 'Chiudi lo storico',
  historyOf: 'Storico di {file}',
  loadingHistory: 'Carico lo storico...',
  noFileCommits: 'Nessun commit per questo file.',
  historyErr: 'Storico: {msg}',
  first200: 'Mostrati i primi 200 commit',
  current: 'corrente',
  switchTo: 'Passare a {name}?',
  localBranches: 'Locali ({n})',
  remoteBranches: 'Remoti ({n})',
  remotesHint: 'I remoti sono quelli già noti in locale: usa Fetch per aggiornarli.',
  tipBranchSel: 'Branch da mostrare',
  allBranches: 'Tutti i branch',
  remotesLabel: 'Remoti',
  uncommitted: 'Modifiche non committate',
  tipOpenChanges: 'Apri il tab Modifiche',
  loadMore: 'Carica altri {n}',
  loadingCommit: 'Carico il commit...',
  graphErr: 'Grafo: {msg}',
  commitErr: 'Commit: {msg}',
  tipCloseDetail: 'Chiudi il dettaglio',
  tipSplitter: 'Trascina per ridimensionare lista e dettaglio',
  diffInvalid: 'File non valido',
  diffBinary: 'File binario: nessun diff testuale.',
  diffNone: 'Nessuna differenza testuale.',
  diffFold: '··· {n} righe invariate ···'
}

export const DICTIONARIES: Record<Lang, Record<Key, string>> = { en, it }

/** `setting` = valore di `language` (auto|en|it); `locale` = lingua del sistema (es. `it-IT`). */
export function resolveLang(setting: unknown, locale: string): Lang {
  if (setting === 'en' || setting === 'it') return setting
  return locale.toLowerCase().startsWith('it') ? 'it' : 'en'
}

export type Translate = (key: Key, vars?: Record<string, string | number>) => string

export function makeT(lang: Lang): Translate {
  const dict = DICTIONARIES[lang]
  return (key, vars) => dict[key].replace(/\{(\w+)\}/g, (_, k: string) => String(vars?.[k] ?? ''))
}

/** Lingua nel formato di `toLocaleString`. */
export const dateLocale = (lang: Lang): string => (lang === 'it' ? 'it-IT' : 'en-GB')
