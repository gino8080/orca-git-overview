/** Workspace come lo elenca `workspace.list` (solo i campi usati per riconoscere quello attivo). */
export interface WsInfo {
  name: string;
  path: string;
  branch: string | null;
}

export type WsPick<T extends WsInfo> =
  { kind: 'found'; ws: T } | { kind: 'none' } | { kind: 'ambiguous'; names: string[] };

const inside = (child: string, parent: string): boolean =>
  child === parent || child.startsWith(parent.replace(/[\\/]+$/, '') + '/');

/**
 * Riconosce il workspace attivo. `workspace.readContext` dà solo nome e branch: se più workspace
 * hanno la stessa coppia (es. due `develop` su `develop`) si usano le cartelle dei terminali del
 * workspace attivo (`terminalPaths`) per sceglierne uno; se non basta, si dichiara l'ambiguità
 * invece di prenderne uno a caso.
 */
export function pickWorkspace<T extends WsInfo>(
  list: T[],
  ctx: { displayName: string; branch: string },
  terminalPaths: string[],
): WsPick<T> {
  const same = list.filter(
    (w) => w.name === ctx.displayName && (w.branch ?? '') === (ctx.branch ?? ''),
  );
  if (same.length === 0) return { kind: 'none' };
  if (same.length === 1) return { kind: 'found', ws: same[0] };
  const exact = same.filter((w) => terminalPaths.includes(w.path));
  if (exact.length === 1) return { kind: 'found', ws: exact[0] };
  // un terminale può stare in una sottocartella: vince il workspace più profondo che lo contiene
  const containing = same.filter((w) => terminalPaths.some((p) => inside(p, w.path)));
  if (containing.length > 0) {
    const deepest = Math.max(...containing.map((w) => w.path.length));
    const best = containing.filter((w) => w.path.length === deepest);
    if (best.length === 1) return { kind: 'found', ws: best[0] };
  }
  return { kind: 'ambiguous', names: same.map((w) => w.path) };
}
