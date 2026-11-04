import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assertHash,
  assertRel,
  clampLimit,
  gitErrorLine,
  parseBranches,
  parseFileLog,
  parseFiles,
  parseGraphLog,
  parseNameStatus,
  parseNumstatZ,
  parseRefs,
  parseStatus,
} from '../src/worker';

test('parseStatus: branch, upstream, ahead/behind e conteggi', () => {
  const out = [
    '# branch.oid abc',
    '# branch.head develop',
    '# branch.upstream origin/develop',
    '# branch.ab +2 -1',
    '1 M. N... 100644 100644 100644 a b staged.ts',
    '1 .M N... 100644 100644 100644 a b dirty.ts',
    '1 MM N... 100644 100644 100644 a b both.ts',
    'u UU N... 100644 100644 100644 100644 a b c conflict.ts',
    '? new.txt',
  ].join('\n');
  const s = parseStatus(out);
  assert.equal(s.branch, 'develop');
  assert.equal(s.upstream, 'origin/develop');
  assert.deepEqual([s.ahead, s.behind], [2, 1]);
  assert.deepEqual([s.staged, s.unstaged, s.untracked, s.conflicts], [2, 2, 1, 1]);
  assert.equal(parseStatus('# branch.head (detached)').detached, true);
});

test('parseFiles: un file staged e modificato compare due volte; spazi nei nomi', () => {
  const out = [
    '1 MM N... 100644 100644 100644 a b src/a b.ts',
    '2 R. N... 100644 100644 100644 a b R100 new.ts\told.ts',
    '? dir/x.txt',
  ].join('\n');
  const files = parseFiles(out);
  assert.deepEqual(
    files.map((f) => [f.path, f.group, f.code]),
    [
      ['src/a b.ts', 'staged', 'M'],
      ['src/a b.ts', 'unstaged', 'M'],
      ['new.ts', 'staged', 'R'],
      ['dir/x.txt', 'untracked', '?'],
    ],
  );
  assert.equal(files[2].origPath, 'old.ts');
});

test('parseBranches: salta HEAD remoto, riconosce corrente e remoti', () => {
  const out = [
    'refs/heads/main\tmain\torigin/main\t[ahead 1]\t1700000000\t*',
    'refs/remotes/origin/HEAD\torigin\t\t\t1700000000\t',
    'refs/remotes/origin/main\torigin/main\t\t\t1700000000\t',
  ].join('\n');
  const b = parseBranches(out);
  assert.equal(b.length, 2);
  assert.equal(b[0].current, true);
  assert.equal(b[0].track, '[ahead 1]');
  assert.equal(b[1].remote, true);
});

test('parseRefs: HEAD, tag e remoti', () => {
  const refs = parseRefs(
    'HEAD -> develop, tag: v1, origin/develop, origin/HEAD, feat/x',
    ['origin'],
  );
  assert.deepEqual(refs, [
    { name: 'develop', kind: 'head', current: true },
    { name: 'v1', kind: 'tag' },
    { name: 'origin/develop', kind: 'remote' },
    { name: 'feat/x', kind: 'head' },
  ]);
});

test('parseGraphLog: genitori multipli e oggetto con tab', () => {
  const out =
    '\x01aaa\tbbb ccc\tAnn\t1700000000\tHEAD -> main\tfix:\tdue tab\n\x01bbb\t\tBob\t1699999999\t\tinizio\n';
  const c = parseGraphLog(out, []);
  assert.equal(c.length, 2);
  assert.deepEqual(c[0].parents, ['bbb', 'ccc']);
  assert.equal(c[0].subject, 'fix:\tdue tab');
  assert.deepEqual(c[1].parents, []);
});

test('parseFileLog: prende il percorso del file nel commit (rinomine)', () => {
  const out =
    '\x01abc\tAnn\t1700000000\tsoggetto\n\nold/name.ts\n\x01def\tAnn\t1600000000\tprima\n\nname.ts\n';
  const c = parseFileLog(out);
  assert.deepEqual(
    c.map((x) => x.path),
    ['old/name.ts', 'name.ts'],
  );
});

test('parseNameStatus: rinomina con due percorsi', () => {
  const f = parseNameStatus('M\ta.ts\nR100\told.ts\tnew.ts\n');
  assert.deepEqual(
    f.map((x) => [x.code, x.path, x.origPath]),
    [
      ['M', 'a.ts', undefined],
      ['R', 'new.ts', 'old.ts'],
    ],
  );
});

test('parseNumstatZ: binari e rinomine', () => {
  const out = '3\t1\ta.ts\0-\t-\timg.png\0' + '0\t0\t\0old.ts\0new.ts\0';
  const m = parseNumstatZ(out);
  assert.deepEqual(m.get('a.ts'), [3, 1]);
  assert.deepEqual(m.get('img.png'), [null, null]);
  assert.deepEqual(m.get('new.ts'), [0, 0]);
});

test('assertRel rifiuta percorsi assoluti, .. e NUL', () => {
  assert.equal(assertRel('src/a.ts'), 'src/a.ts');
  for (const bad of ['/etc/passwd', '../x', 'a/../../x', '', 'a\0b'])
    assert.throws(() => assertRel(bad));
});

test('assertHash accetta solo hex di 4-40 caratteri', () => {
  assert.equal(assertHash('abc1234'), 'abc1234');
  for (const bad of ['--all', 'abc', 'xyz1234', '-n1', 'a'.repeat(41)])
    assert.throws(() => assertHash(bad));
});

test('clampLimit limita e ripiega sul default', () => {
  assert.equal(clampLimit(10), 10);
  assert.equal(clampLimit(0), 1);
  assert.equal(clampLimit(1e9), 5000);
  assert.equal(clampLimit('x'), 300);
});

test("gitErrorLine: prende la riga fatal, non l'ultima del suggerimento", () => {
  const msg = [
    'Command failed: git fetch --quiet --no-tags',
    "fatal: '/x/y.git' does not appear to be a git repository",
    'fatal: Could not read from remote repository.',
    '',
    'Please make sure you have the correct access rights',
    'and the repository exists.',
  ].join('\n');
  assert.equal(gitErrorLine(msg), "'/x/y.git' does not appear to be a git repository");
  assert.equal(gitErrorLine('boom\n\nultima riga\n'), 'ultima riga');
  assert.equal(gitErrorLine(''), '');
});
