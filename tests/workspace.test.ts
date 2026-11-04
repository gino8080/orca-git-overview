import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pickWorkspace } from '../shared/workspace';

const ws = (name: string, path: string, branch: string | null = 'develop') => ({
  name,
  path,
  branch,
});
const ctx = { displayName: 'develop', branch: 'develop' };

test('pickWorkspace: un solo candidato', () => {
  const list = [ws('develop', '/a/CORE-PDF'), ws('main', '/a/x', 'main')];
  assert.deepEqual(pickWorkspace(list, ctx, []), { kind: 'found', ws: list[0] });
});

test('pickWorkspace: nessun candidato', () => {
  assert.deepEqual(pickWorkspace([ws('main', '/a', 'main')], ctx, []), { kind: 'none' });
});

test('pickWorkspace: omonimi risolti dal terminale', () => {
  const list = [ws('develop', '/a/CORE-PDF'), ws('develop', '/a/aily-instruments')];
  assert.deepEqual(pickWorkspace(list, ctx, ['/a/aily-instruments']), {
    kind: 'found',
    ws: list[1],
  });
});

test('pickWorkspace: terminale in una sottocartella, vince il più profondo', () => {
  const list = [ws('develop', '/a'), ws('develop', '/a/b')];
  assert.deepEqual(pickWorkspace(list, ctx, ['/a/b/src']), {
    kind: 'found',
    ws: list[1],
  });
});

test('pickWorkspace: omonimi senza terminali = ambiguo', () => {
  const list = [ws('develop', '/a/CORE-PDF'), ws('develop', '/a/aily-instruments')];
  assert.deepEqual(pickWorkspace(list, ctx, []), {
    kind: 'ambiguous',
    names: ['/a/CORE-PDF', '/a/aily-instruments'],
  });
});

test('pickWorkspace: /ab non è dentro /a', () => {
  const list = [ws('develop', '/a'), ws('develop', '/ab')];
  assert.deepEqual(pickWorkspace(list, ctx, ['/ab/x']), { kind: 'found', ws: list[1] });
});
