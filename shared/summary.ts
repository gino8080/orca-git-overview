// Riepilogo di un gruppo di repo: lo usano il pannello (barra in testa) e il worker (status bar).
import type { FetchResult, RepoStatus } from '../src/protocol';
import type { Translate } from './i18n';

export const dirtyCount = (r: RepoStatus): number =>
  r.staged + r.unstaged + r.untracked + r.conflicts;

export interface Summary {
  total: number;
  /** Repo con almeno una modifica locale. */
  dirty: number;
  /** Repo con commit da scaricare (behind > 0). */
  behind: number;
  /** Repo con commit da pubblicare (ahead > 0). */
  ahead: number;
  /** Repo con conflitti in corso. */
  conflicts: number;
  /** Repo che git non ha saputo leggere. */
  errors: number;
  /** Branch distinti fra i repo leggibili (HEAD staccato conta come uno a parte): >1 = gruppo non allineato. */
  branches: number;
}

/** Repo leggibili raggruppati per branch (HEAD staccato in un gruppo a sé), il più numeroso prima. */
export function branchGroups(
  repos: RepoStatus[],
): { branch: string; detached: boolean; repos: string[] }[] {
  const groups = new Map<
    string,
    { branch: string; detached: boolean; repos: string[] }
  >();
  for (const r of repos) {
    if (r.error) continue;
    const key = r.detached ? '\0detached' : r.branch;
    const g = groups.get(key) ?? { branch: r.branch, detached: r.detached, repos: [] };
    g.repos.push(r.name);
    groups.set(key, g);
  }
  return [...groups.values()].sort(
    (a, b) => b.repos.length - a.repos.length || a.branch.localeCompare(b.branch),
  );
}

/** Testo multilinea con l'esito del fetch di ogni repo: intestazione + una riga per repo. */
export function fetchReport(
  results: FetchResult[],
  tookMs: number,
  t: Translate,
): string {
  const failed = results.filter((r) => r.error);
  const head = failed.length
    ? t('fetchFailed', { n: failed.length, total: results.length })
    : t('fetchOk', { total: results.length, ms: tookMs });
  const lines = results.map((r) => (r.error ? `✗ ${r.name}: ${r.error}` : `✓ ${r.name}`));
  return [head, ...lines].join('\n');
}

export function summarize(repos: RepoStatus[]): Summary {
  const s: Summary = {
    total: repos.length,
    dirty: 0,
    behind: 0,
    ahead: 0,
    conflicts: 0,
    errors: 0,
    branches: branchGroups(repos).length,
  };
  for (const r of repos) {
    if (r.error) {
      s.errors++;
      continue;
    }
    if (dirtyCount(r) > 0) s.dirty++;
    if (r.behind > 0) s.behind++;
    if (r.ahead > 0) s.ahead++;
    if (r.conflicts > 0) s.conflicts++;
  }
  return s;
}

export type Tone = 'neutral' | 'success' | 'warning' | 'danger';

/** Voce della status bar: testo breve (max 64 caratteri per Orca) e tono. */
export function statusBarState(s: Summary, t: Translate): { text: string; tone: Tone } {
  if (s.total === 0) return { text: t('sbNone'), tone: 'neutral' };
  const parts: string[] = [];
  if (s.errors) parts.push(t('sbErrors', { n: s.errors }));
  if (s.conflicts) parts.push(t('sbConflicts', { n: s.conflicts }));
  if (s.dirty) parts.push(t('sbDirty', { n: s.dirty }));
  if (s.behind) parts.push(t('sbBehind', { n: s.behind }));
  if (parts.length === 0)
    return {
      text: s.total === 1 ? t('sbClean1') : t('sbClean', { n: s.total }),
      tone: 'success',
    };
  return {
    text: parts.join(' · ').slice(0, 64),
    tone: s.errors || s.conflicts ? 'danger' : 'warning',
  };
}
