import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeT } from '../shared/i18n';
import { branchGroups, fetchReport, statusBarState, summarize } from '../shared/summary';
import type { RepoStatus } from '../src/protocol';

const repo = (over: Partial<RepoStatus> = {}): RepoStatus => ({
  name: 'r',
  path: '/r',
  branch: 'main',
  detached: false,
  upstream: 'origin/main',
  ahead: 0,
  behind: 0,
  staged: 0,
  unstaged: 0,
  untracked: 0,
  conflicts: 0,
  stash: 0,
  lastCommitAt: null,
  lastCommitSubject: '',
  ...over,
});

test('summarize: conta repo sporchi, indietro, avanti, conflitti ed errori', () => {
  const s = summarize([
    repo(),
    repo({ unstaged: 2, ahead: 1 }),
    repo({ behind: 3, untracked: 1 }),
    repo({ conflicts: 1, staged: 1 }),
    repo({ error: 'not a git repository' }),
  ]);
  assert.deepEqual(s, {
    total: 5,
    dirty: 3,
    behind: 1,
    ahead: 1,
    conflicts: 1,
    errors: 1,
    branches: 1,
  });
});

test('statusBarState: pulito, da guardare, in errore, vuoto', () => {
  const t = makeT('en');
  assert.deepEqual(statusBarState(summarize([repo(), repo()]), t), {
    text: '2 repos clean',
    tone: 'success',
  });
  assert.deepEqual(
    statusBarState(summarize([repo({ unstaged: 1 }), repo({ behind: 1 })]), t),
    { text: '1 with changes · 1 behind', tone: 'warning' },
  );
  assert.equal(statusBarState(summarize([repo({ error: 'x' })]), t).tone, 'danger');
  assert.deepEqual(statusBarState(summarize([]), t), {
    text: 'no repos',
    tone: 'neutral',
  });
  assert.equal(statusBarState(summarize([repo()]), t).text, '1 repo clean');
});

test('statusBarState: testo entro i 64 caratteri di Orca', () => {
  const s = {
    total: 999,
    dirty: 999,
    behind: 999,
    ahead: 0,
    conflicts: 999,
    errors: 999,
    branches: 1,
  };
  assert.ok(statusBarState(s, makeT('it')).text.length <= 64);
});

test('branchGroups: raggruppa per branch, HEAD staccato a parte, errori esclusi', () => {
  const groups = branchGroups([
    repo({ name: 'a' }),
    repo({ name: 'b', branch: 'develop' }),
    repo({ name: 'c' }),
    repo({ name: 'd', branch: 'main', detached: true }),
    repo({ name: 'e', branch: 'x', error: 'boom' }),
  ]);
  assert.deepEqual(groups, [
    { branch: 'main', detached: false, repos: ['a', 'c'] },
    { branch: 'develop', detached: false, repos: ['b'] },
    { branch: 'main', detached: true, repos: ['d'] },
  ]);
  assert.equal(summarize([repo(), repo({ name: 'b', branch: 'dev' })]).branches, 2);
  assert.equal(summarize([repo(), repo({ name: 'b' })]).branches, 1);
});

test('fetchReport: una riga per repo, con esito e errore', () => {
  const t = makeT('en');
  assert.equal(
    fetchReport([{ name: 'a' }, { name: 'b' }], 12, t),
    'Fetch ok on 2 repos in 12 ms\n✓ a\n✓ b',
  );
  assert.equal(
    fetchReport([{ name: 'a' }, { name: 'b', error: 'no remote' }], 5, t),
    'Fetch failed on 1 of 2\n✓ a\n✗ b: no remote',
  );
});
