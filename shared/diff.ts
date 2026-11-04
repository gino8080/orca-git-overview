// Parser unified-diff e renderer affiancato/unificato, condivisi dall'editor .gitdiff e dal pannello.
export interface DiffPayload {
  title: string
  file: string
  diff: string
  /** Lingua dei testi dell'editor (l'editor isolato non legge i setting). */
  lang?: Lang
}
import { makeT, type Lang } from './i18n'

export type DiffMode = 'split' | 'unified'

type Kind = 'ctx' | 'del' | 'add' | 'mod'
export interface Row {
  kind: Kind
  oldNo: number | null
  oldText: string
  newNo: number | null
  newText: string
}

const FOLD_MIN = 14
const FOLD_KEEP = 3

export function parseUnified(diff: string): { rows: Row[]; binary: boolean; added: number; deleted: number } {
  const rows: Row[] = []
  let oldNo = 0
  let newNo = 0
  let dels: string[] = []
  let adds: string[] = []
  let added = 0
  let deleted = 0
  let inHunk = false
  const flush = () => {
    const n = Math.max(dels.length, adds.length)
    for (let i = 0; i < n; i++) {
      const d = i < dels.length
      const a = i < adds.length
      rows.push({
        kind: d && a ? 'mod' : d ? 'del' : 'add',
        oldNo: d ? oldNo++ : null,
        oldText: d ? dels[i] : '',
        newNo: a ? newNo++ : null,
        newText: a ? adds[i] : ''
      })
    }
    deleted += dels.length
    added += adds.length
    dels = []
    adds = []
  }
  if (/^Binary files .* differ$/m.test(diff) || /^GIT binary patch/m.test(diff)) {
    return { rows, binary: true, added, deleted }
  }
  for (const line of diff.split('\n')) {
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
    if (h) {
      flush()
      oldNo = Number(h[1])
      newNo = Number(h[2])
      inHunk = true
      continue
    }
    if (!inHunk) continue
    const c = line[0]
    if (c === '-') dels.push(line.slice(1))
    else if (c === '+') adds.push(line.slice(1))
    else if (c === ' ') {
      flush()
      rows.push({ kind: 'ctx', oldNo: oldNo++, oldText: line.slice(1), newNo: newNo++, newText: line.slice(1) })
    }
  }
  flush()
  return { rows, binary: false, added, deleted }
}

export const DIFF_CSS = `
:root { color-scheme: light dark; }
body { margin:0; font:12.5px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
  color:var(--orca-foreground); background:var(--orca-background); }
header.dh { position:sticky; top:0; z-index:1; padding:8px 12px; display:flex; gap:12px; align-items:baseline;
  background:var(--orca-background); border-bottom:1px solid rgba(128,128,128,.3); }
header.dh b { font-weight:600 } header.dh span { opacity:.7 }
.add-n { color:#3fb950 } .del-n { color:#f85149 }
table { width:100%; border-collapse:collapse; table-layout:fixed }
td { vertical-align:top; padding:0 6px; white-space:pre-wrap; overflow-wrap:anywhere }
td.n { width:44px; text-align:right; opacity:.5; user-select:none }
td.t { width:calc(50% - 44px) }
td.u { width:auto }
tr.del td.u { background:rgba(248,81,73,.18) }
tr.add td.u { background:rgba(63,185,80,.18) }
td.gap { border-left:1px solid rgba(128,128,128,.3) }
tr.del td.o, tr.mod td.o { background:rgba(248,81,73,.18) }
tr.add td.nw, tr.mod td.nw { background:rgba(63,185,80,.18) }
tr.del td.nw, tr.add td.o { background:rgba(128,128,128,.10) }
tr.fold td { text-align:center; padding:2px; cursor:pointer; opacity:.7; background:rgba(128,128,128,.12) }
tr.fold:hover td { opacity:1 }
.msg { padding:16px; opacity:.7 }
`

function cell(cls: string, text: string): HTMLTableCellElement {
  const td = document.createElement('td')
  td.className = cls
  td.textContent = text
  return td
}

function unifiedEls(r: Row): HTMLTableRowElement[] {
  const mk = (cls: string, no1: number | null, no2: number | null, sign: string, text: string) => {
    const tr = document.createElement('tr')
    tr.className = cls
    tr.append(
      cell('n', no1 === null ? '' : String(no1)),
      cell('n nw gap', no2 === null ? '' : String(no2)),
      cell('t u', sign + text)
    )
    return tr
  }
  if (r.kind === 'ctx') return [mk('ctx', r.oldNo, r.newNo, ' ', r.oldText)]
  const out: HTMLTableRowElement[] = []
  if (r.kind === 'del' || r.kind === 'mod') out.push(mk('del', r.oldNo, null, '-', r.oldText))
  if (r.kind === 'add' || r.kind === 'mod') out.push(mk('add', null, r.newNo, '+', r.newText))
  return out
}

function rowEl(r: Row): HTMLTableRowElement {
  const tr = document.createElement('tr')
  tr.className = r.kind
  tr.append(
    cell('n o', r.oldNo === null ? '' : String(r.oldNo)),
    cell('t o', r.oldText),
    cell('n nw gap', r.newNo === null ? '' : String(r.newNo)),
    cell('t nw', r.newText)
  )
  return tr
}

export function renderDiff(root: HTMLElement, p: DiffPayload, mode: DiffMode = 'split'): void {
  root.replaceChildren()
  const t = makeT(p.lang ?? 'en')
  const { rows, binary, added, deleted } = parseUnified(p.diff)
  const head = document.createElement('header')
  head.className = 'dh'
  head.innerHTML = '<b></b><span></span><span class="add-n"></span><span class="del-n"></span>'
  const [b, s, a, d] = Array.from(head.children) as HTMLElement[]
  b.textContent = p.file
  s.textContent = p.title
  a.textContent = `+${added}`
  d.textContent = `-${deleted}`
  root.append(head)
  if (binary || rows.length === 0) {
    const m = document.createElement('div')
    m.className = 'msg'
    m.textContent = binary ? t('diffBinary') : t('diffNone')
    root.append(m)
    return
  }
  const els = (r: Row): HTMLTableRowElement[] => (mode === 'split' ? [rowEl(r)] : unifiedEls(r))
  const tbody = document.createElement('tbody')
  const table = document.createElement('table')
  table.append(tbody)
  let i = 0
  while (i < rows.length) {
    if (rows[i].kind !== 'ctx') {
      tbody.append(...els(rows[i++]))
      continue
    }
    let j = i
    while (j < rows.length && rows[j].kind === 'ctx') j++
    const run = rows.slice(i, j)
    const atStart = i === 0
    const atEnd = j === rows.length
    if (run.length < FOLD_MIN) {
      run.forEach((r) => tbody.append(...els(r)))
    } else {
      const head = atStart ? 0 : FOLD_KEEP
      const tail = atEnd ? 0 : FOLD_KEEP
      run.slice(0, head).forEach((r) => tbody.append(...els(r)))
      const hidden = run.slice(head, run.length - tail)
      const fold = document.createElement('tr')
      fold.className = 'fold'
      const td = cell('', t('diffFold', { n: hidden.length }))
      td.colSpan = mode === 'split' ? 4 : 3
      fold.append(td)
      fold.addEventListener('click', () => fold.replaceWith(...hidden.flatMap(els)))
      tbody.append(fold)
      run.slice(run.length - tail).forEach((r) => tbody.append(...els(r)))
    }
    i = j
  }
  root.append(table)
}

