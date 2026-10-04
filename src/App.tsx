import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Select from '@radix-ui/react-select';
import { ArrowRightIcon, CheckIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, Cross2Icon,
  GlobeIcon, InfoCircledIcon, MixerHorizontalIcon, PauseIcon, PlayIcon, ResetIcon, RowsIcon } from '@radix-ui/react-icons';
import RouteWeb from './RouteWeb';
import { eventLabel, getFixture, initialView, PREFIX, routeLabel, SCENARIOS, snapshotAt, START, timeLabel,
  type RouteState, type Scenario } from './replay';

function Dropdown({ label, value, options, onChange }: {
  label: string; value: string; options: { id: string; label: string }[]; onChange: (value: string) => void;
}) {
  return <Select.Root value={value} onValueChange={onChange}>
    <Select.Trigger className="select-trigger" aria-label={label}><Select.Value /><Select.Icon><ChevronDownIcon aria-hidden="true" /></Select.Icon></Select.Trigger>
    <Select.Portal><Select.Content className="select-menu" position="popper" sideOffset={6}>
      <Select.Viewport>{options.map(option => <Select.Item key={option.id} value={option.id} className="select-item">
        <Select.ItemText>{option.label}</Select.ItemText><Select.ItemIndicator><CheckIcon aria-hidden="true" /></Select.ItemIndicator>
      </Select.Item>)}</Select.Viewport>
    </Select.Content></Select.Portal>
  </Select.Root>;
}

function Modal({ title, children, trigger, className = '' }: { title: string; children: ReactNode; trigger: ReactNode; className?: string }) {
  return <Dialog.Root><Dialog.Trigger asChild>{trigger}</Dialog.Trigger><Dialog.Portal>
    <Dialog.Overlay className="dialog-overlay" /><Dialog.Content className={`dialog-content ${className}`}>
      <div className="dialog-heading"><Dialog.Title>{title}</Dialog.Title><Dialog.Close className="icon-button" aria-label="Close dialog"><Cross2Icon /></Dialog.Close></div>
      {children}
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}

function PathText({ path, fallback = 'No observed path' }: { path: number[]; fallback?: string }) {
  return <div className="path-text">{path.length ? path.map((asn, i) => <span key={`${asn}-${i}`}>
    {i > 0 && <ArrowRightIcon aria-hidden="true" />}<code>AS{asn}</code>
  </span>) : <span className="muted">{fallback}</span>}</div>;
}

export default function App() {
  const [initial] = useState(initialView);
  const [scenario, setScenario] = useState<Scenario>(initial.scenario);
  const [time, setTime] = useState(initial.time);
  const [observerIds, setObserverIds] = useState(initial.observerIds);
  const [selectedId, setSelectedId] = useState<string | null>(initial.selectedId);
  const [drawerOpen, setDrawerOpen] = useState(!!initial.selectedId);
  const evidenceTrigger = useRef<HTMLElement | SVGElement | null>(null);
  const [isolate, setIsolate] = useState<string | null>(null);
  const [compare, setCompare] = useState(initial.compare);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState('1');
  const [mode, setMode] = useState<'replay' | 'live'>('replay');
  const [capturedTime, setCapturedTime] = useState(initial.time);
  const [liveFollowing, setLiveFollowing] = useState(true);
  const [observerPage, setObserverPage] = useState(0);
  const [hidden, setHidden] = useState(document.hidden);
  const [reducedMotion, setReducedMotion] = useState(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const fixture = useMemo(() => getFixture(scenario), [scenario]);
  const snapshot = useMemo(() => snapshotAt(fixture, time), [fixture, time]);
  const baseline = useMemo(() => snapshotAt(fixture, 0), [fixture]);
  const displayed = useMemo(() => observerIds.map(id => snapshot.routes.find(r => r.observer.id === id)).filter((r): r is RouteState => !!r), [observerIds, snapshot]);
  const before = useMemo(() => observerIds.map(id => baseline.routes.find(r => r.observer.id === id)).filter((r): r is RouteState => !!r), [observerIds, baseline]);
  const selected = snapshot.routes.find(r => r.observer.id === selectedId);
  const selectedBaseline = baseline.routes.find(r => r.observer.id === selectedId);
  const observed = snapshot.routes.filter(r => r.status === 'observed').length;
  const withdrawn = snapshot.routes.filter(r => r.status === 'withdrawn').length;
  const uncertain = snapshot.routes.filter(r => r.status === 'uncertain').length;
  const unknown = snapshot.routes.filter(r => r.status === 'unknown').length;
  const unavailable = ['loading', 'error'].includes(scenario);
  const disabled = ['loading', 'error', 'empty'].includes(scenario);
  const upcoming = fixture.events.filter(event => event.at > time).sort((a, b) => a.at - b.at)[0];

  useEffect(() => {
    const onVisibility = () => setHidden(document.hidden);
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onMotion = () => setReducedMotion(media.matches);
    document.addEventListener('visibilitychange', onVisibility);
    media.addEventListener('change', onMotion);
    return () => { document.removeEventListener('visibilitychange', onVisibility); media.removeEventListener('change', onMotion); };
  }, []);

  useEffect(() => {
    if (!playing || hidden || mode !== 'replay' || disabled) return;
    const timer = window.setInterval(() => setTime(value => Math.min(fixture.duration, value + 1)), 250 / Number(speed));
    return () => window.clearInterval(timer);
  }, [playing, hidden, mode, speed, fixture.duration, disabled]);
  useEffect(() => { if (time >= fixture.duration) setPlaying(false); }, [time, fixture.duration]);

  useEffect(() => {
    if (mode !== 'live' || disabled) return;
    // The simulated capture clock continues when presentation is paused.
    const startedAt = Date.now(), initialCapture = capturedTime;
    const timer = window.setInterval(() => {
      const next = Math.min(fixture.duration, initialCapture + Math.floor((Date.now() - startedAt) / 1000));
      setCapturedTime(next);
      if (next >= fixture.duration) window.clearInterval(timer);
    }, 250);
    return () => window.clearInterval(timer);
  }, [mode, scenario, disabled, fixture.duration]);
  useEffect(() => { if (mode === 'live' && liveFollowing && !hidden) setTime(capturedTime); }, [capturedTime, mode, liveFollowing, hidden]);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('scenario', scenario);
    url.searchParams.set('t', String(time));
    url.searchParams.set('observers', observerIds.join(','));
    if (selectedId && drawerOpen) url.searchParams.set('route', selectedId); else url.searchParams.delete('route');
    if (compare) url.searchParams.set('compare', '1'); else url.searchParams.delete('compare');
    window.history.replaceState(null, '', url);
  }, [scenario, time, observerIds, selectedId, drawerOpen, compare]);

  function selectRoute(id: string, trigger?: HTMLElement | SVGElement) {
    evidenceTrigger.current = trigger ?? document.activeElement as HTMLElement | SVGElement | null;
    setSelectedId(id); setDrawerOpen(true);
  }
  function seek(value: number) {
    setPlaying(false);
    if (mode === 'live') setLiveFollowing(false);
    setTime(value);
  }
  function chooseScenario(id: string) {
    const next = getFixture(id as Scenario);
    setScenario(id as Scenario); setTime(next.initialTime); setCapturedTime(next.initialTime);
    setObserverIds(next.observers.slice(0, 6).map(o => o.id)); setObserverPage(0);
    setPlaying(false); setIsolate(null); setSelectedId(null); setDrawerOpen(false); setCompare(false);
    setMode('replay'); setLiveFollowing(true);
  }
  function step(direction: number) {
    const positions = [...new Set([0, ...fixture.events.map(event => event.at), fixture.duration])].sort((a, b) => a - b);
    seek(direction > 0 ? positions.find(value => value > time) ?? fixture.duration : positions.filter(value => value < time).at(-1) ?? 0);
  }
  function togglePlayback() {
    if (mode === 'live') { setLiveFollowing(!liveFollowing); if (!liveFollowing) setTime(capturedTime); }
    else { if (time === fixture.duration) setTime(0); setPlaying(!playing); }
  }
  function chooseMode(next: 'replay' | 'live') {
    setMode(next); setPlaying(false);
    if (next === 'live') { setCapturedTime(Math.max(time, capturedTime)); setTime(Math.max(time, capturedTime)); setLiveFollowing(true); }
  }

  return <>
    <a className="skip-link" href="#investigation">Skip to investigation</a>
    <header className="masthead">
      <div className="brand"><GlobeIcon aria-hidden="true" /><h1>Internet Routing Monitor</h1><span className="prototype-label">Prototype</span></div>
      <Modal title="About this replay" trigger={<button className="text-button about-trigger"><InfoCircledIcon aria-hidden="true" />About this replay</button>}>
        <Dialog.Description className="dialog-description">A deterministic demonstration of routing observations.</Dialog.Description>
        <p>Every observer, transit path, event, and timestamp in this prototype is synthetic. The prefix and destination identify a proposed historical target: Facebook’s October 2021 outage. Historical reconstruction still needs validated records and a baseline.</p>
        <p>Lines show observed network relationships. They do not show physical cables, packets, global reachability, or a proven fault location.</p>
        <p>Transit ASNs use the private range, and peer addresses use a documentation range. Live demo runs a simulated feed; external capture is a later build stage.</p>
        <a href="https://labs.ripe.net/author/alun_davies/facebook-down-and-out-in-bgplay/" target="_blank" rel="noreferrer">Read the RIPE incident analysis <ArrowRightIcon aria-hidden="true" /></a>
      </Modal>
    </header>
    <div className="workspace-bar">
      <div className="prefix-control"><span className="control-label">Watched prefix</span><code translate="no">{PREFIX}</code></div>
      <div className="incident-control"><span className="control-label">Demo scenario</span><Dropdown label="Demo scenario" value={scenario} options={SCENARIOS} onChange={chooseScenario} /></div>
      <div className="mode-control" role="group" aria-label="Observation mode"><button aria-pressed={mode === 'replay'} onClick={() => chooseMode('replay')}>Replay</button><button aria-pressed={mode === 'live'} onClick={() => chooseMode('live')}>Live demo</button></div>
      <div className="freshness"><span>{mode === 'live' ? liveFollowing ? 'Simulated feed' : 'Presentation paused' : playing ? 'Replay playing' : 'Replay paused'}</span><span className="muted">Synthetic data</span></div>
    </div>
    <main id="investigation" tabIndex={-1}>
      <div className="investigation-heading">
        <div><div className="incident-date">4 October 2021 <span> / </span> Routing investigation</div><h2>{scenario === 'coverage' ? 'When an observer goes quiet.' : scenario === 'unknown' ? 'Start with what is known.' : 'Watch the route web unravel.'}</h2><p>Follow one prefix through a withdrawal and recovery. Inspect the evidence at every step.</p></div>
        <div className="observation-count"><strong>{unavailable ? 'N/A' : observed.toString().padStart(2, '0')}</strong><span>{unavailable ? <>Route snapshot<br />unavailable</> : <>of {fixture.observers.length.toString().padStart(2, '0')} observers<br />report an observed path</>}</span></div>
      </div>
      <section className="investigation-panel" aria-label="Prefix route investigation">
        <div className="canvas-toolbar">
          <div className="legend"><span><i className="legend-line observed" />Observed</span><span><i className="legend-line selected" />Selected / new</span><span><i className="legend-line withdrawn" />Withdrawn</span><span><i className="legend-line uncertain" />Uncertain</span></div>
          <div className="canvas-actions">
            {isolate && <button className="text-button" onClick={() => setIsolate(null)}>Show all observers</button>}
            <button className={`text-button ${compare ? 'active-text' : ''}`} aria-pressed={compare} onClick={() => setCompare(!compare)} disabled={disabled}><RowsIcon aria-hidden="true" />Compare baseline</button>
          </div>
        </div>
        {scenario === 'loading' ? <div className="canvas-state loading-state" aria-busy="true"><div className="loading-lines" aria-hidden="true" /><h3>Loading route snapshot…</h3><p>This demo holds the loading state for inspection.</p><button onClick={() => chooseScenario('incident')}>Open replay</button></div>
          : scenario === 'error' ? <div className="canvas-state"><InfoCircledIcon aria-hidden="true" /><h3>The observation source is unavailable.</h3><p>No route state can be confirmed. Open the saved demonstration to continue.</p><button onClick={() => chooseScenario('incident')}>Open saved replay</button></div>
          : scenario === 'empty' ? <div className="canvas-state"><GlobeIcon aria-hidden="true" /><h3>No observations for this interval.</h3><p>An empty interval does not establish a withdrawal or a loss of reachability.</p><button onClick={() => chooseScenario('incident')}>Open demo interval</button></div>
          : <RouteWeb routes={displayed} baseline={before} selected={selectedId} isolate={isolate} compare={compare} time={time} hidden={hidden} reducedMotion={reducedMotion} onSelect={selectRoute} />}
        <div className="coverage-bar" aria-live="polite">
          <span><InfoCircledIcon aria-hidden="true" />{unavailable ? 'Snapshot unavailable' : scenario === 'empty' ? 'No observations in this interval' : scenario === 'stale' ? 'Stale fixture: no new observations for 5 minutes. Last-known state only.' : uncertain > 0 ? `${uncertain} observer uncertain. Reconnection alone does not restore coverage.` : unknown > 0 ? `${unknown} observers have no baseline. Silence does not establish withdrawal.` : 'All available observers have a known starting state.'}</span>
          <span>{compare ? 'Dashed gray = starting baseline' : 'Observed relationships, not physical links'}</span>
        </div>
        <div className="timeline">
          <div className="timeline-heading"><span>Replay timeline <span className="muted"> / 2 minute fixture</span></span><code>{timeLabel(time)} <span className="muted">UTC</span></code></div>
          <div className="timeline-track">
            <svg viewBox="0 0 1100 72" preserveAspectRatio="none" aria-hidden="true">
              <line x1="0" x2="1100" y1="55" y2="55" stroke="#35424f" />
              {Array.from({ length: 61 }, (_, i) => <line key={i} x1={i * 1100 / 60} x2={i * 1100 / 60} y1={i % 5 ? 51 : 44} y2="58" stroke="#35424f" />)}
              {!disabled && fixture.events.map((event, i) => <rect key={event.id} x={event.at / fixture.duration * 1100 - 1.5} y={event.kind === 'withdrawal' ? 13 + i % 3 * 7 : 32} width="3" height={event.kind === 'withdrawal' ? 30 - i % 3 * 7 : 13} fill={event.kind === 'withdrawal' ? '#ff9284' : event.kind.startsWith('gap') ? '#b7c4ce' : '#71d9e3'} opacity={event.at <= time ? 1 : .6} />)}
              <line x1={time / fixture.duration * 1100} x2={time / fixture.duration * 1100} y1="0" y2="68" stroke="#e8edf1" strokeWidth="1.5" />
            </svg>
            <input type="range" name="replay-position" aria-label="Replay position" aria-valuetext={`${timeLabel(time)} UTC, ${snapshot.events.length} applied events`} min="0" max={fixture.duration} step="1" value={time} onChange={event => seek(Number(event.target.value))} disabled={disabled} />
          </div>
          <div className="timeline-labels"><span>{timeLabel(0)}</span><span>Withdrawals</span><span>Recovery</span><span>{timeLabel(fixture.duration)} UTC</span></div>
          <div className="playback-bar">
            <div className="playback-buttons">
              <button className="icon-button" aria-label="Restart replay" disabled={disabled} onClick={() => seek(0)}><ResetIcon /></button>
              <button className="icon-button" aria-label="Previous event" disabled={disabled || time === 0} onClick={() => step(-1)}><ChevronLeftIcon /></button>
              <button className="play-button" aria-label={mode === 'live' ? liveFollowing ? 'Pause presentation' : 'Return to live demo' : playing ? 'Pause replay' : 'Play replay'} disabled={disabled} onClick={togglePlayback}>
                {(mode === 'live' ? liveFollowing : playing) ? <PauseIcon aria-hidden="true" /> : <PlayIcon aria-hidden="true" />}{mode === 'live' ? liveFollowing ? 'Pause' : 'Return to live' : playing ? 'Pause' : 'Play'}
              </button>
              <button className="icon-button" aria-label="Next event" disabled={disabled || time === fixture.duration} onClick={() => step(1)}><ChevronRightIcon /></button>
              <Dropdown label="Playback speed" value={speed} options={[{ id: '1', label: '1×' }, { id: '2', label: '2×' }, { id: '4', label: '4×' }]} onChange={setSpeed} />
            </div>
            <span className="next-event">{disabled ? unavailable ? 'Awaiting a route snapshot' : 'No events in this interval' : mode === 'live' ? `Simulated capture: ${timeLabel(capturedTime)} UTC` : upcoming ? `Next: ${eventLabel(upcoming.kind).toLowerCase()} at ${timeLabel(upcoming.at)}` : 'End of replay'}</span>
            <span className="playback-status">{withdrawn} withdrawn <span> / </span> {uncertain} uncertain</span>
          </div>
        </div>
      </section>
      <section className="observations-section" aria-labelledby="observations-title">
        <div className="observations-heading"><div><h3 id="observations-title">Observer paths</h3><span className="muted">{disabled ? 0 : isolate ? 1 : displayed.length} displayed / {fixture.observers.length} available</span></div>
          <Modal title="Choose observers" trigger={<button className="text-button" disabled={disabled}><MixerHorizontalIcon aria-hidden="true" />Choose observers</button>}>
            <Dialog.Description className="dialog-description">Display up to 6 paths. Clear a selected observer to make room for another.</Dialog.Description>
            <span className="selection-count" aria-live="polite">{observerIds.length} of 6 selected / {fixture.observers.length} available</span>
            <div className="observer-choices">{fixture.observers.slice(observerPage * 12, observerPage * 12 + 12).map(observer => <label key={observer.id}>
              <input type="checkbox" name="observer" value={observer.id} checked={observerIds.includes(observer.id)} disabled={!observerIds.includes(observer.id) && observerIds.length >= 6}
                onChange={event => { setObserverIds(ids => event.target.checked ? [...ids, observer.id] : ids.filter(id => id !== observer.id)); setIsolate(null); }} />
              <span>{observer.city}<small>{observer.collector} · AS{observer.asn}</small></span>
            </label>)}</div>
            {fixture.observers.length > 12 && <div className="choice-pagination"><button onClick={() => setObserverPage(p => p - 1)} disabled={observerPage === 0}>Previous</button><span>Page {observerPage + 1} / {Math.ceil(fixture.observers.length / 12)}</span><button onClick={() => setObserverPage(p => p + 1)} disabled={(observerPage + 1) * 12 >= fixture.observers.length}>Next</button></div>}
            <Dialog.Close className="primary-button">Done</Dialog.Close>
          </Modal>
        </div>
        <div className="route-list">{!disabled && displayed.filter(route => !isolate || route.observer.id === isolate).map(route => <button key={route.observer.id} className={`route-row ${selectedId === route.observer.id ? 'selected-row' : ''}`} onClick={event => selectRoute(route.observer.id, event.currentTarget)}>
          <span className="route-observer">{route.observer.city}<small>{route.observer.collector}</small></span>
          <span className={`route-status ${route.status}`}>{routeLabel(route.status)}</span>
          <span className="route-as-path">{route.path.length ? route.path.map(asn => `AS${asn}`).join(' → ') : route.status === 'unknown' ? 'No baseline acquired' : 'No current observed path'}</span>
          <ChevronRightIcon aria-hidden="true" />
        </button>)}{!disabled && displayed.length === 0 && <p className="no-observers">Choose an observer to display its path.</p>}{disabled && <p className="no-observers">{scenario === 'empty' ? 'No observers in this interval.' : 'Observer paths will appear when a snapshot is available.'}</p>}</div>
      </section>
      <footer className="workspace-footer"><span>Synthetic fixture · Historical validation pending</span><span>Source clock: {timeLabel(time)} UTC · Simulated processing delay: 180 ms</span></footer>
    </main>
    <Dialog.Root open={drawerOpen && !!selected} onOpenChange={setDrawerOpen}><Dialog.Portal>
      <Dialog.Overlay className="dialog-overlay drawer-overlay" /><Dialog.Content className="evidence-drawer" onCloseAutoFocus={event => {
        if (evidenceTrigger.current?.isConnected) { event.preventDefault(); evidenceTrigger.current.focus(); }
      }}>
        <div className="dialog-heading"><Dialog.Title>Route evidence</Dialog.Title><Dialog.Close className="icon-button" aria-label="Close evidence"><Cross2Icon /></Dialog.Close></div>
        <Dialog.Description className="dialog-description">{selected?.observer.city} observation at {timeLabel(time)} UTC</Dialog.Description>
        {selected && <>
          <div className={`evidence-status ${selected.status}`}>{routeLabel(selected.status)}</div>
          <dl className="evidence-details"><div><dt>Prefix</dt><dd><code>{PREFIX}</code></dd></div><div><dt>Collector</dt><dd>{selected.observer.collector}</dd></div><div><dt>Peer</dt><dd><code>{selected.observer.peer} · AS{selected.observer.asn}</code></dd></div><div><dt>Latest evidence</dt><dd>{selected.lastEvent ? eventLabel(selected.lastEvent.kind) : selected.observer.baseline ? 'Fixture baseline' : 'No baseline'}</dd></div><div><dt>Source time</dt><dd><code>{timeLabel(selected.lastEvent?.at ?? 0)} UTC</code></dd></div><div><dt>Receipt delay</dt><dd>180 ms (simulated)</dd></div><div><dt>Coverage</dt><dd>{selected.gapOpen ? 'Capture gap open' : selected.status === 'uncertain' ? 'Reconnected; state still uncertain' : selected.status === 'unknown' ? 'Baseline not acquired' : 'Known fixture state'}</dd></div></dl>
          <div className="path-comparison"><h4>Starting baseline</h4><PathText path={selectedBaseline?.path ?? []} fallback="Unknown starting baseline" /><h4>Before latest route change</h4><PathText path={selected.previousPath} fallback="No earlier path in this fixture state" /><h4>At replay position</h4><PathText path={selected.path} /></div>
          <button className="isolate-button" aria-pressed={isolate === selectedId} onClick={() => { setIsolate(isolate === selectedId ? null : selectedId); setDrawerOpen(false); }}>{isolate === selectedId ? 'Show all observers' : 'Isolate this observer'}<ArrowRightIcon aria-hidden="true" /></button>
          <h4>Supporting fixture record</h4><pre className="evidence-record">{JSON.stringify({ source: 'synthetic-fixture', eventId: selected.lastEvent?.id ?? `baseline:${selected.observer.id}`, collector: selected.observer.collector, peer: selected.observer.peer, prefix: PREFIX, kind: selected.lastEvent?.kind ?? (selected.observer.baseline ? 'baseline' : 'unknown'), sourceTime: new Date(START + (selected.lastEvent?.at ?? 0) * 1000).toISOString(), receivedAt: new Date(START + (selected.lastEvent?.at ?? 0) * 1000 + 180).toISOString(), path: selected.lastEvent?.path ?? selected.path, projectionCursor: snapshot.cursor }, null, 2)}</pre>
          <p className="evidence-note">Synthetic evidence demonstrates the inspection flow. It does not establish what any real collector observed in October 2021.</p>
        </>}
      </Dialog.Content>
    </Dialog.Portal></Dialog.Root>
  </>;
}
