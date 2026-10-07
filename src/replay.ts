import historicalReplay from '../data/facebook-2021/replay.json';

export type RouteStatus = 'observed' | 'withdrawn' | 'uncertain' | 'unknown';
export type EventKind = 'announcement' | 'path-change' | 'withdrawal' | 'gap-start' | 'gap-end';
export type Scenario = 'historical' | 'incident' | 'coverage' | 'unknown' | 'dense' | 'empty' | 'loading' | 'error' | 'stale';

export interface ArchiveEvidence {
  archive: string;
  sha256: string;
  prefixElement: number;
  sourceTime: string;
  raw: Record<string, unknown>;
}

export interface Observer {
  id: string;
  city: string;
  collector: string;
  peer: string;
  asn: number;
  baseline: number[] | null;
  baselineStatus?: RouteStatus;
  baselineEvidence?: ArchiveEvidence;
}
export interface RouteEvent {
  id: string;
  at: number;
  observerId: string;
  kind: EventKind;
  path?: number[];
  sequence?: number;
  evidence?: ArchiveEvidence;
}
export interface RouteState {
  observer: Observer;
  status: RouteStatus;
  path: number[];
  previousPath: number[];
  gapOpen: boolean;
  lastEvent: RouteEvent | null;
}
export interface Fixture {
  id: Scenario;
  observers: Observer[];
  events: RouteEvent[];
  duration: number;
  initialTime: number;
  source?: 'ris-mrt';
  start?: number;
}

export const PREFIX = '129.134.30.0/24';
export const START = Date.parse('2021-10-04T15:38:00Z');
export const SCENARIOS: { id: Scenario; label: string }[] = [
  { id: 'historical', label: 'Facebook outage · RIPE RIS archive' },
  { id: 'incident', label: 'Facebook outage · synthetic replay' },
  { id: 'coverage', label: 'Capture gap & recovery' },
  { id: 'unknown', label: 'Unknown starting state' },
  { id: 'dense', label: 'Dense observer collection' },
  { id: 'empty', label: 'No observations' },
  { id: 'loading', label: 'Loading snapshot' },
  { id: 'error', label: 'Source unavailable' },
  { id: 'stale', label: 'Stale observations' },
];
const cities = ['Amsterdam', 'London', 'Frankfurt', 'Paris', 'Stockholm', 'New York', 'Singapore', 'São Paulo'];
const paths = [
  [64512, 64520, 64530, 32934], [64513, 64520, 64530, 32934],
  [64514, 64521, 64530, 32934], [64515, 64522, 64540, 32934],
  [64516, 64521, 64540, 32934], [64517, 64522, 64540, 32934],
  [64518, 64520, 64530, 32934], [64519, 64522, 64540, 32934],
];
const observers: Observer[] = cities.map((city, i) => ({
  id: `demo-${i + 1}`, city, collector: `fixture-collector-${i + 1}`,
  peer: `192.0.2.${i + 1}`, asn: 64512 + i, baseline: i < 6 ? paths[i] : null,
}));
const events: RouteEvent[] = [
  { id: 'fixture-001', at: 20, observerId: 'demo-1', kind: 'path-change', path: [64512, 64521, 64530, 32934] },
  { id: 'fixture-002', at: 30, observerId: 'demo-1', kind: 'withdrawal' },
  { id: 'fixture-003', at: 36, observerId: 'demo-2', kind: 'withdrawal' },
  { id: 'fixture-004', at: 42, observerId: 'demo-3', kind: 'withdrawal' },
  { id: 'fixture-005', at: 46, observerId: 'demo-4', kind: 'withdrawal' },
  { id: 'fixture-006', at: 48, observerId: 'demo-5', kind: 'gap-start' },
  { id: 'fixture-007', at: 50, observerId: 'demo-5', kind: 'announcement', path: paths[4] },
  { id: 'fixture-008', at: 54, observerId: 'demo-6', kind: 'withdrawal' },
  { id: 'fixture-009', at: 68, observerId: 'demo-5', kind: 'gap-end' },
  { id: 'fixture-010', at: 78, observerId: 'demo-1', kind: 'announcement', path: paths[0] },
  { id: 'fixture-011', at: 84, observerId: 'demo-2', kind: 'announcement', path: paths[1] },
  { id: 'fixture-012', at: 90, observerId: 'demo-5', kind: 'announcement', path: paths[4] },
  { id: 'fixture-013', at: 96, observerId: 'demo-3', kind: 'announcement', path: paths[2] },
  { id: 'fixture-014', at: 102, observerId: 'demo-4', kind: 'announcement', path: paths[3] },
  { id: 'fixture-015', at: 108, observerId: 'demo-6', kind: 'announcement', path: paths[5] },
  { id: 'fixture-016', at: 114, observerId: 'demo-7', kind: 'announcement', path: paths[6] },
  { id: 'fixture-017', at: 118, observerId: 'demo-8', kind: 'announcement', path: paths[7] },
];

export function getFixture(id: Scenario): Fixture {
  if (id === 'historical') return historicalReplay as Fixture;
  if (id === 'dense') {
    return {
      id, duration: 120, initialTime: 12,
      observers: Array.from({ length: 240 }, (_, i) => ({
        ...observers[i % 8], id: `dense-${i + 1}`, city: `${cities[i % 8]} ${Math.floor(i / 8) + 1}`,
        collector: `fixture-collector-${i + 1}`, baseline: paths[i % 8],
      })),
      events: Array.from({ length: 240 }, (_, i) => ({
        id: `dense-event-${i + 1}`, observerId: `dense-${i + 1}`, at: 20 + i % 50,
        kind: 'withdrawal' as const,
      })),
    };
  }
  return {
    id, duration: 120, initialTime: id === 'coverage' ? 50 : id === 'unknown' ? 0 : 12,
    observers: id === 'empty' ? [] : observers.map(o => ({ ...o, baseline: id === 'unknown' ? null : o.baseline })),
    events: id === 'empty' ? [] : events,
  };
}

// Rebuild from the immutable baseline on every seek, including backward seeks.
export function snapshotAt(fixture: Fixture, requestedTime: number) {
  const time = Math.max(0, Math.min(fixture.duration, requestedTime));
  const states = new Map<string, RouteState>(fixture.observers.map(observer => [observer.id, {
    observer, status: observer.baselineStatus ?? (observer.baseline ? 'observed' : 'unknown'), path: observer.baseline?.slice() ?? [],
    previousPath: [], gapOpen: false, lastEvent: null,
  }]));
  const accepted = new Set<string>();
  const applied: RouteEvent[] = [];
  const ordered = fixture.events.slice().sort((a, b) => a.at - b.at || (a.sequence ?? 0) - (b.sequence ?? 0) || a.id.localeCompare(b.id));
  for (const event of ordered) {
    if (event.at > time || accepted.has(event.id)) continue;
    const route = states.get(event.observerId);
    if (!route) continue;
    accepted.add(event.id);
    applied.push(event);
    route.lastEvent = event;
    if (event.kind === 'gap-start') {
      route.gapOpen = true;
      if (route.status !== 'unknown') route.status = 'uncertain';
    } else if (event.kind === 'gap-end') {
      // Reconnection alone supplies no replacement baseline.
      route.gapOpen = false;
    } else if (event.kind === 'withdrawal') {
      route.previousPath = route.path.slice();
      route.path = [];
      route.status = route.gapOpen ? 'uncertain' : 'withdrawn';
    } else {
      route.previousPath = route.path.slice();
      route.path = event.path?.slice() ?? [];
      route.status = route.gapOpen ? 'uncertain' : 'observed';
    }
  }
  return {
    time, routes: [...states.values()], events: applied,
    cursor: `${fixture.source === 'ris-mrt' ? 'archive' : 'fixture'}:${fixture.id}:${time}:${applied.length}`,
  };
}

export function supportedEdges(routes: RouteState[]) {
  const edges = new Map<string, { from: number; to: number; observers: string[]; uncertain: string[] }>();
  for (const route of routes) {
    if (route.status === 'withdrawn' || route.status === 'unknown') continue;
    for (let i = 1; i < route.path.length; i++) {
      const from = route.path[i - 1], to = route.path[i], key = `${from}:${to}`;
      const edge = edges.get(key) ?? { from, to, observers: [], uncertain: [] };
      const support = route.status === 'uncertain' ? edge.uncertain : edge.observers;
      if (!support.includes(route.observer.id)) support.push(route.observer.id);
      edges.set(key, edge);
    }
  }
  return [...edges.values()];
}

export function timeLabel(seconds: number, start = START) {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'UTC',
  }).format(start + seconds * 1000);
}

export function eventLabel(kind: EventKind) {
  return { announcement: 'Announcement', 'path-change': 'Path change', withdrawal: 'Withdrawal',
    'gap-start': 'Capture gap', 'gap-end': 'Source reconnected' }[kind];
}

export function routeLabel(status: RouteStatus) {
  return { observed: 'Observed', withdrawn: 'Withdrawn', uncertain: 'Uncertain', unknown: 'Unknown baseline' }[status];
}

export function initialView() {
  const query = new URLSearchParams(window.location.search);
  const scenario = SCENARIOS.find(s => s.id === query.get('scenario'))?.id ?? 'historical';
  const fixture = getFixture(scenario);
  const raw = Number(query.get('t') ?? fixture.initialTime);
  const ids = query.get('observers')?.split(',').filter(id => fixture.observers.some(o => o.id === id));
  return {
    scenario, time: Number.isFinite(raw) ? Math.max(0, Math.min(fixture.duration, raw)) : fixture.initialTime,
    observerIds: [...new Set(ids?.length ? ids : fixture.observers.slice(0, 6).map(o => o.id))].slice(0, 6),
    selectedId: fixture.observers.find(o => o.id === query.get('route'))?.id ?? null,
    compare: query.get('compare') === '1',
  };
}
