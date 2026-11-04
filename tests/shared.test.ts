import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseUnified } from '../shared/diff'
import { layoutGraph } from '../shared/graph'

const c = (hash: string, ...parents: string[]) => ({ hash, parents })

test('layoutGraph: storia lineare = una sola corsia', () => {
  const l = layoutGraph([c('c', 'b'), c('b', 'a'), c('a')], 'c')
  assert.deepEqual(l.nodes.map((n) => n.cx), [12, 12, 12])
  assert.equal(l.nodes[0].current, true)
  assert.equal(l.height, 72)
})

test('layoutGraph: merge a diamante usa due corsie e si richiude', () => {
  const l = layoutGraph([c('m', 'a', 'b'), c('a', 'r'), c('b', 'r'), c('r')], 'm')
  assert.deepEqual(l.nodes.map((n) => (n.cx - 12) / 16), [0, 0, 1, 0])
  assert.ok(l.paths.some((p) => p.d.includes('C')), 'servono curve per i cambi di corsia')
})

test('layoutGraph: la riga "non committata" è tratteggiata', () => {
  const l = layoutGraph([{ hash: 'U', parents: ['h'], uncommitted: true }, c('h')], 'h')
  assert.equal(l.nodes[0].committed, false)
  assert.ok(l.paths.some((p) => !p.committed))
})

test('layoutGraph: genitore fuori pagina non rompe il layout', () => {
  const l = layoutGraph([c('b', 'missing'), c('a', 'missing')], null)
  assert.equal(l.nodes.length, 2)
})

test('parseUnified: righe, contatori e binari', () => {
  const diff = ['diff --git a/x b/x', '--- a/x', '+++ b/x', '@@ -1,3 +1,3 @@', ' uno', '-due', '+DUE', ' tre'].join('\n')
  const r = parseUnified(diff)
  assert.deepEqual([r.added, r.deleted, r.binary], [1, 1, false])
  assert.deepEqual(r.rows.map((x) => x.kind), ['ctx', 'mod', 'ctx'])
  assert.equal(parseUnified('Binary files a/x and b/x differ').binary, true)
})
