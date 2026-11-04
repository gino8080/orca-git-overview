// Riepilogo di un gruppo di repo: lo usano il pannello (barra in testa) e il worker (status bar).
import type { RepoStatus } from '../src/protocol';
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
}

export function summarize(repos: RepoStatus[]): Summary {
  const s: Summary = {
    total: repos.length,
    dirty: 0,
    behind: 0,
    ahead: 0,
    conflicts: 0,
    errors: 0,
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
