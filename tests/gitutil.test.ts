import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLimiter, unquoteC } from '../shared/gitutil';
import { parseFiles, parseNameStatus } from '../src/worker';

test('unquoteC lascia stare i percorsi non quotati', () => {
  assert.equal(unquoteC('src/a.ts'), 'src/a.ts');
  assert.equal(unquoteC('"'), '"');
});

test('unquoteC decodifica escape, virgolette e ottali UTF-8', () => {
  assert.equal(unquoteC('"a\\"b.txt"'), 'a"b.txt');
  assert.equal(unquoteC('"tab\\tname"'), 'tab\tname');
  assert.equal(unquoteC('"nl\\nname"'), 'nl\nname');
  assert.equal(unquoteC('"back\\\\slash"'), 'back\\slash');
  assert.equal(unquoteC('"caff\\303\\250"'), 'caffè');
});

test('parseFiles e parseNameStatus decodificano i percorsi quotati', () => {
  const st = '? "a\\"b.txt"\n';
  assert.equal(parseFiles(st)[0].path, 'a"b.txt');
  const ns = 'R100\t"old\\tname"\t"new\\tname"\n';
  const [f] = parseNameStatus(ns);
  assert.equal(f.path, 'new\tname');
  assert.equal(f.origPath, 'old\tname');
});

test('createLimiter: mai oltre il massimo, ordine FIFO, slot liberato se il lavoro fallisce', async () => {
  const limited = createLimiter(2);
  let running = 0;
  let peak = 0;
  const order: number[] = [];
  const job = (i: number, fail = false) =>
    limited(async () => {
      order.push(i);
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      if (fail) throw new Error('boom');
      return i;
    });
  const res = await Promise.allSettled([job(0), job(1, true), job(2), job(3), job(4)]);
  assert.equal(peak, 2);
  assert.deepEqual(order, [0, 1, 2, 3, 4]);
  assert.equal(res.filter((r) => r.status === 'rejected').length, 1);
  // Lo stato torna pulito: un nuovo lavoro parte subito.
  assert.equal(await job(9), 9);
});
