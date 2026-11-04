import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DICTIONARIES, makeT, resolveLang, type Key } from '../shared/i18n';

const placeholders = (s: string): string[] =>
  [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test('en e it hanno le stesse chiavi e gli stessi segnaposto', () => {
  const keys = Object.keys(DICTIONARIES.en) as Key[];
  assert.deepEqual(Object.keys(DICTIONARIES.it).sort(), [...keys].sort());
  for (const k of keys) {
    assert.deepEqual(
      placeholders(DICTIONARIES.it[k]),
      placeholders(DICTIONARIES.en[k]),
      `segnaposto diversi in "${k}"`,
    );
    assert.ok(
      DICTIONARIES.en[k].length > 0 && DICTIONARIES.it[k].length > 0,
      `testo vuoto in "${k}"`,
    );
  }
});

test('resolveLang: setting esplicito vince, auto segue il sistema, default inglese', () => {
  assert.equal(resolveLang('en', 'it-IT'), 'en');
  assert.equal(resolveLang('it', 'en-US'), 'it');
  assert.equal(resolveLang('auto', 'it-IT'), 'it');
  assert.equal(resolveLang(undefined, 'de-DE'), 'en');
});

test('makeT sostituisce i segnaposto', () => {
  assert.equal(
    makeT('en')('fetchOk', { total: 5, ms: 42 }),
    'Fetch ok on 5 repos in 42 ms',
  );
  assert.equal(makeT('it')('nFiles', { n: 3 }), '3 file');
});

test('makeT usa il singolare con conteggio 1 (n o total)', () => {
  assert.equal(makeT('en')('nFiles', { n: 1 }), '1 file');
  assert.equal(makeT('en')('nFiles', { n: 0 }), '0 files');
  assert.equal(makeT('it')('nFiles', { n: 1 }), '1 file');
  assert.equal(makeT('en')('fetchOk', { total: 1, ms: 9 }), 'Fetch ok on 1 repo in 9 ms');
  assert.equal(makeT('it')('fetchOk', { total: 1, ms: 9 }), 'Fetch ok su 1 repo in 9 ms');
});
