// Layout e rendering SVG del grafo dei commit. Codice originale.
//
// Algoritmo: si scorrono i commit in ordine topologico (figli prima dei genitori) tenendo una lista
// di corsie; ogni corsia "aspetta" l'hash del prossimo commit che la attraversa. Per ogni riga:
//  1. il commit va nella prima corsia che lo aspetta (o in una libera, se è la punta di un ramo);
//  2. le altre corsie che lo aspettavano convergono su di lui e si liberano;
//  3. il primo genitore eredita la corsia del commit, gli altri ne prendono una libera
//     (o si agganciano a quella in cui il genitore è già atteso).
// Ogni collegamento tra una riga e la successiva diventa un segmento (retto o curvo).

export interface GraphInput {
  hash: string
  parents: string[]
}

export interface GraphGrid {
  x: number
  y: number
  offsetX: number
  offsetY: number
}

export const DEFAULT_GRID: GraphGrid = { x: 16, y: 24, offsetX: 12, offsetY: 12 }
export const GRAPH_COLOURS = ['#4e9af1', '#e5604d', '#5cc16a', '#e0a030', '#9b6bd6', '#2bb5a8', '#d65aa0', '#8aa63a', '#d9794a', '#6f86d6', '#c9b038', '#5aa0b8']
const UNCOMMITTED_COLOUR = '#808080'

export interface GraphPath {
  d: string
  colour: number
  committed: boolean
}

export interface GraphNode {
  row: number
  cx: number
  cy: number
  colour: number
  committed: boolean
  current: boolean
}

export interface GraphLayout {
  paths: GraphPath[]
  nodes: GraphNode[]
  width: number
  height: number
}

/** Collegamento in arrivo su una corsia, partito da `from` (indice di corsia) nella riga precedente. */
interface Incoming {
  from: number
  committed: boolean
}

interface Lane {
  /** Hash del commit che questa corsia aspetta. */
  hash: string
  colour: number
  /** Collegamento principale + eventuali altri agganciati (genitore già atteso in questa corsia). */
  incoming: Incoming[]
}

interface Segment {
  x1: number
  x2: number
  /** Riga di partenza; l'arrivo è sempre la riga successiva. */
  row: number
  colour: number
  committed: boolean
}

/**
 * Calcola corsie, percorsi e nodi. `commits` in ordine topologico; un elemento con `uncommitted`
 * (la riga "modifiche non committate", in testa) viene disegnato tratteggiato e in grigio.
 */
export function layoutGraph(
  commits: (GraphInput & { uncommitted?: boolean })[],
  headHash: string | null,
  grid: GraphGrid = DEFAULT_GRID
): GraphLayout {
  const lanes: (Lane | null)[] = []
  const segments: Segment[] = []
  const nodes: GraphNode[] = []
  let maxLane = 0

  const freeColour = (): number => {
    const used = new Set(lanes.filter((l): l is Lane => l !== null).map((l) => l.colour))
    let c = 0
    while (used.has(c)) c++
    return c
  }
  const freeLane = (): number => {
    const i = lanes.indexOf(null)
    return i >= 0 ? i : lanes.length
  }

  /** Emette i segmenti dalla riga `row - 1` alla riga `row`; `target` = hash del commit della riga (null = oltre la fine). */
  const flushIncoming = (row: number, target: string | null, nodeLane: number): void => {
    lanes.forEach((lane, x) => {
      if (!lane) return
      const to = lane.hash === target ? nodeLane : x
      for (const inc of lane.incoming) segments.push({ x1: inc.from, x2: to, row: row - 1, colour: lane.colour, committed: inc.committed })
      lane.incoming = [{ from: x, committed: true }]
      if (to !== x) lanes[x] = null // la corsia converge sul commit e si libera
    })
  }

  commits.forEach((c, row) => {
    // 1. corsia del commit
    let lane = lanes.findIndex((l) => l?.hash === c.hash)
    const isTip = lane < 0
    if (isTip) lane = freeLane()
    // 2. segmenti in arrivo (le corsie che aspettavano questo commit convergono qui)
    const prevColour = isTip ? freeColour() : lanes[lane]!.colour
    flushIncoming(row, c.hash, lane)
    const colour = prevColour
    const committed = !c.uncommitted
    nodes.push({ row, cx: lane * grid.x + grid.offsetX, cy: row * grid.y + grid.offsetY, colour, committed, current: !!c.uncommitted || c.hash === headHash })
    maxLane = Math.max(maxLane, lane)
    // 3. genitori
    lanes[lane] = null
    c.parents.forEach((p, i) => {
      const existing = lanes.findIndex((l) => l?.hash === p)
      if (existing >= 0) {
        lanes[existing]!.incoming.push({ from: lane, committed })
        return
      }
      const target = i === 0 ? lane : freeLane()
      lanes[target] = { hash: p, colour: i === 0 ? colour : freeColour(), incoming: [{ from: lane, committed }] }
      maxLane = Math.max(maxLane, target)
    })
  })
  // Le corsie ancora aperte proseguono fino al bordo inferiore (storia oltre la pagina caricata).
  flushIncoming(commits.length, null, 0)

  // Segmenti dritti consecutivi sulla stessa corsia e colore: un solo tratto.
  const paths: GraphPath[] = []
  const runs = new Map<string, { x: number; y1: number; y2: number; colour: number; committed: boolean }>()
  const px = (x: number): number => x * grid.x + grid.offsetX
  const py = (row: number): number => row * grid.y + grid.offsetY
  const closeRun = (key: string): void => {
    const r = runs.get(key)
    if (r) paths.push({ d: `M${px(r.x)},${py(r.y1)}L${px(r.x)},${py(r.y2)}`, colour: r.colour, committed: r.committed })
    runs.delete(key)
  }
  const bend = grid.y * 0.6
  for (const s of segments.sort((a, b) => a.row - b.row)) {
    if (s.x1 === s.x2) {
      const key = `${s.x1}|${s.colour}|${s.committed}`
      const run = runs.get(key)
      if (run && run.y2 === s.row) run.y2 = s.row + 1
      else {
        closeRun(key)
        runs.set(key, { x: s.x1, y1: s.row, y2: s.row + 1, colour: s.colour, committed: s.committed })
      }
    } else {
      const [xa, ya, xb, yb] = [px(s.x1), py(s.row), px(s.x2), py(s.row + 1)]
      paths.push({ d: `M${xa},${ya}C${xa},${ya + bend} ${xb},${yb - bend} ${xb},${yb}`, colour: s.colour, committed: s.committed })
    }
  }
  for (const key of [...runs.keys()]) closeRun(key)

  return { paths, nodes, width: 2 * grid.offsetX + maxLane * grid.x, height: commits.length * grid.y }
}

const SVG_NS = 'http://www.w3.org/2000/svg'
const colourOf = (i: number, committed: boolean): string => (committed ? GRAPH_COLOURS[i % GRAPH_COLOURS.length] : UNCOMMITTED_COLOUR)

function svgEl(tag: string, attrs: Record<string, string>): SVGElement {
  const el = document.createElementNS(SVG_NS, tag)
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
  return el
}

/** Disegna il layout in un nuovo <svg>. Il fondo dei nodi "correnti" è quello della pagina. */
export function renderGraphSvg(layout: GraphLayout): SVGSVGElement {
  const svg = svgEl('svg', { width: String(layout.width), height: String(layout.height) }) as SVGSVGElement
  for (const p of layout.paths) {
    // Alone del colore di sfondo sotto la linea: separa i tratti che si incrociano.
    svg.append(svgEl('path', { d: p.d, fill: 'none', stroke: 'var(--orca-background)', 'stroke-width': '4' }))
    svg.append(svgEl('path', {
      d: p.d, fill: 'none', stroke: colourOf(p.colour, p.committed), 'stroke-width': '2',
      ...(p.committed ? {} : { 'stroke-dasharray': '2px' })
    }))
  }
  for (const n of layout.nodes) {
    const colour = colourOf(n.colour, n.committed)
    svg.append(svgEl('circle', {
      cx: String(n.cx), cy: String(n.cy), r: '4',
      ...(n.current ? { fill: 'var(--orca-background)', stroke: colour, 'stroke-width': '2' } : { fill: colour })
    }))
  }
  return svg
}
