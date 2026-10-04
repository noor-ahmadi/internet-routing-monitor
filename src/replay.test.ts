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
