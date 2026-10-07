import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getFixture, snapshotAt, supportedEdges } from './replay';

test('seeking is deterministic, including backward navigation and duplicate identities', () => {
  const fixture = getFixture('incident');
  const expected = snapshotAt(fixture, 42);
  snapshotAt(fixture, 120);
  assert.deepEqual(snapshotAt(fixture, 42), expected);
  const duplicate = { ...fixture, events: [...fixture.events.slice().reverse(), fixture.events[0]] };
  assert.deepEqual(snapshotAt(duplicate, 42), expected);
  assert.equal(snapshotAt(fixture, -5).time, 0);
  assert.equal(snapshotAt(fixture, 500).time, 120);
});

test('one withdrawal preserves a shared segment supported by another observer', () => {
  const routes = snapshotAt(getFixture('incident'), 30).routes;
  assert.equal(routes[0].status, 'withdrawn');
  assert.deepEqual(routes[0].path, []);
  const shared = supportedEdges(routes).find(e => e.from === 64530 && e.to === 32934);
  assert.deepEqual(shared?.observers, ['demo-2', 'demo-3']);
  assert(!supportedEdges(routes).some(e => e.observers.includes('demo-1')));
});

test('unknown state never invents a route; a gap remains uncertain after reconnect', () => {
  const fixture = getFixture('incident');
  assert.equal(snapshotAt(fixture, 0).routes[6].status, 'unknown');
  assert.deepEqual(snapshotAt(getFixture('unknown'), 0).routes.map(r => r.path), Array(8).fill([]));
  for (const at of [48, 50, 68, 77]) {
    assert.equal(snapshotAt(fixture, at).routes[4].status, 'uncertain');
  }
  assert.equal(snapshotAt(fixture, 68).routes[4].gapOpen, false);
  const edges = supportedEdges(snapshotAt(fixture, 54).routes);
  assert(edges.every(e => e.observers.length === 0));
  assert(edges.some(e => e.uncertain.includes('demo-5')));
  assert.equal(snapshotAt(fixture, 90).routes[4].status, 'observed');
});

test('path replacement and reannouncement use complete observer paths', () => {
  const fixture = getFixture('incident');
  const changed = snapshotAt(fixture, 20).routes[0];
  assert.deepEqual(changed.previousPath, [64512, 64520, 64530, 32934]);
  assert.deepEqual(changed.path, [64512, 64521, 64530, 32934]);
  assert.equal(snapshotAt(fixture, 78).routes[0].status, 'observed');
  assert.deepEqual(snapshotAt(fixture, 78).routes[0].path, fixture.observers[0].baseline);
  assert.equal(snapshotAt(getFixture('empty'), 0).routes.length, 0);
  assert.equal(snapshotAt(getFixture('dense'), 69).routes.filter(r => r.status === 'withdrawn').length, 240);
});

test('validated historical replay seeks through withdrawal and route return', () => {
  const replay = getFixture('historical');
  assert.equal(replay.source, 'ris-mrt');
  assert.equal(replay.duration, 21300);
  assert.equal(snapshotAt(replay, 0).routes.filter(r => r.status === 'observed').length, 3);
  assert.equal(snapshotAt(replay, 900).routes.filter(r => r.status === 'withdrawn').length, 3);
  assert.equal(snapshotAt(replay, replay.duration).routes.filter(r => r.status === 'observed').length, 3);
  const withdrawn = snapshotAt(replay, 900);
  snapshotAt(replay, replay.duration);
  assert.deepEqual(snapshotAt(replay, 900), withdrawn);
  assert.equal(withdrawn.cursor, `archive:historical:900:${withdrawn.events.length}`);
  assert(replay.events.every(e => e.evidence?.sha256.length === 64));
});

test('same-second archive observations retain source order across seeks', () => {
  const replay = getFixture('incident');
  const events = [
    { id: 'z', at: 20, sequence: 1, observerId: 'demo-1', kind: 'announcement' as const, path: [64512, 174, 32934] },
    { id: 'a', at: 20, sequence: 2, observerId: 'demo-1', kind: 'withdrawal' as const },
  ];
  assert.equal(snapshotAt({ ...replay, events: events.slice().reverse() }, 20).routes[0].status, 'withdrawn');
});

test('a repeated AS edge contributes at most one support per observer', () => {
  const replay = getFixture('incident');
  const routes = snapshotAt(replay, 0).routes.slice(0, 1);
  routes[0].path = [64512, 174, 174, 174, 32934];
  assert.deepEqual(supportedEdges(routes).find(e => e.from === 174 && e.to === 174)?.observers, ['demo-1']);
});
