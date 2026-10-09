import { useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Select from '@radix-ui/react-select';
import { ArrowRightIcon, CheckIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon,
  GlobeIcon, InfoCircledIcon, MixerHorizontalIcon, PauseIcon, PlayIcon, ResetIcon, RowsIcon, HamburgerMenuIcon } from '@radix-ui/react-icons';
import * as m from 'motion/react-m';
import { Modal, Sheet } from './Sheet';
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
  const [explorerOpen, setExplorerOpen] = useState(false);
  const [explorerTab, setExplorerTab] = useState<'replay' | 'paths'>('replay');
  const pathsTrigger = useRef<HTMLButtonElement>(null);
  const explorerTrigger = useRef<HTMLButtonElement | null>(null);
  const evidenceTrigger = useRef<HTMLElement | SVGElement | null>(null);
  const [isolate, setIsolate] = useState<string | null>(null);
  const [compare, setCompare] = useState(initial.compare);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(initial.scenario === 'historical' ? '600' : '1');
  const [mode, setMode] = useState<'replay' | 'live'>('replay');
  const [capturedTime, setCapturedTime] = useState(initial.time);
  const [liveFollowing, setLiveFollowing] = useState(true);
  const [observerPage, setObserverPage] = useState(0);
  const [hidden, setHidden] = useState(document.hidden);
  const [reducedMotion, setReducedMotion] = useState(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const fixture = useMemo(() => getFixture(scenario), [scenario]);
  const historical = fixture.source === 'ris-mrt';
  const clock = (seconds: number) => timeLabel(seconds, fixture.start ?? START);
  const allPaths = useMemo(() => [...fixture.observers.map(o => o.baseline ?? []), ...fixture.events.map(e => e.path ?? [])], [fixture]);
  const snapshot = useMemo(() => snapshotAt(fixture, time), [fixture, time]);
  const baseline = useMemo(() => snapshotAt(fixture, 0), [fixture]);
  const displayed = useMemo(() => observerIds.map(id => snapshot.routes.find(r => r.observer.id === id)).filter((r): r is RouteState => !!r), [observerIds, snapshot]);
  const before = useMemo(() => observerIds.map(id => baseline.routes.find(r => r.observer.id === id)).filter((r): r is RouteState => !!r), [observerIds, baseline]);
  const selected = snapshot.routes.find(r => r.observer.id === selectedId);
  const selectedBaseline = baseline.routes.find(r => r.observer.id === selectedId);
  const selectedEvidence = selected?.lastEvent?.evidence ?? selected?.observer.baselineEvidence;
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
    const timer = window.setInterval(() => setTime(value => Math.min(fixture.duration, value + Number(speed))), 1000);
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
    setSelectedId(id); setExplorerOpen(false); setDrawerOpen(true);
  }
  function openExplorer(tab: 'replay' | 'paths', trigger: HTMLButtonElement) {
    explorerTrigger.current = trigger; setExplorerTab(tab); setExplorerOpen(true);
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
    setSpeed(id === 'historical' ? '600' : '1');
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
      <button className="explore-button" aria-label="Open explorer" onClick={e => openExplorer('replay', e.currentTarget)}><HamburgerMenuIcon aria-hidden="true" /><span>Explore</span></button>
      <h1>Internet Routing<br />Monitor</h1>
      <span className="masthead-index">A study in visibility <span> / 001</span></span>
      <Modal title="About this replay" description={historical ? 'Saved observations from RIPE NCC RIS.' : 'Deterministic demonstration data.'}
        trigger={<button className="icon-button about-trigger" aria-label="About this replay"><InfoCircledIcon aria-hidden="true" /></button>}>
        {historical ? <><p>This replay reconstructs {PREFIX} from three RRC06 peers, from 15:35 to 21:30 UTC on 4 October 2021. It uses the morning route table and every five-minute update archive through the interval.</p><p>Every required archive is present. No selected peer session transitions were recorded. Archive completeness does not establish uninterrupted external capture or global reachability.</p><p>RIB entry timestamps record when a prefix was heard and can predate table capture. Receipt and processing delay were not recorded. Real live capture is a later build stage.</p><a href="https://www.ripe.net/analyse/internet-measurements/routing-information-service-ris/" target="_blank" rel="noreferrer">RIPE NCC Routing Information Service <ArrowRightIcon aria-hidden="true" /></a></>
          : <><p>All observers, transit paths, events, timestamps, and receipt delays in this scenario are synthetic. The prefix and destination identify the historical target: Facebook’s October 2021 outage.</p><p>Transit ASNs use the private range; peer addresses use a documentation range. Live demo runs a simulated feed.</p></>}
        <p>Lines show observed AS relationships. They do not show physical cables, packets, global reachability, or a proven fault location. Drawing and fading mark recorded route changes.</p>
        <a href="https://labs.ripe.net/author/alun_davies/facebook-down-and-out-in-bgplay/" target="_blank" rel="noreferrer">The RIPE incident analysis <ArrowRightIcon aria-hidden="true" /></a>
      </Modal>
    </header>
    <main id="investigation" tabIndex={-1}>
      <div className="investigation-heading">
        <div className="case-heading"><span className="eyebrow">04 Oct 2021 <span className="case-divider">↗</span> {historical ? 'The archive' : 'Synthetic study'}</span>
          <h2>Facebook<span className="incident-year">/ 2021</span></h2>
          <code className="watched-prefix" translate="no">{PREFIX}</code>
        </div>
        <div className="snapshot-summary">
          <div className="observation-count"><strong>{unavailable ? '—' : observed.toString().padStart(2, '0')}</strong><span>/{fixture.observers.length.toString().padStart(2, '0')}<small>paths observed</small></span></div>
          <div className="freshness"><span className="status-dot" aria-hidden="true" /><span>{historical ? 'RIPE RIS archive' : 'Synthetic data'}</span><span className="sr-only">{mode === 'live' ? liveFollowing ? 'Simulated feed' : 'Presentation paused' : playing ? 'Replay playing' : 'Replay paused'}</span></div>
        </div>
      </div>
      <section className="investigation-panel" aria-label="Prefix route investigation">
        <div className="canvas-toolbar">
          <button className="text-button paths-trigger" ref={pathsTrigger} onClick={e => openExplorer('paths', e.currentTarget)}><span className="tiny-index">01</span> Observers <span className="observer-total">{disabled ? 0 : isolate ? 1 : displayed.length}</span><ArrowRightIcon aria-hidden="true" /></button>
          <span className="canvas-caption">An AS path, from observer to origin</span>
          <div className="canvas-actions">
            {isolate && <button className="text-button" onClick={() => setIsolate(null)}>Show all observers</button>}
            <button className={`icon-button compare-button ${compare ? 'is-active' : ''}`} aria-label="Compare baseline" title="Compare baseline" aria-pressed={compare} onClick={() => setCompare(!compare)} disabled={disabled}><RowsIcon aria-hidden="true" /></button>
          </div>
        </div>
        {scenario === 'loading' ? <div className="canvas-state loading-state" aria-busy="true"><div className="loading-lines" aria-hidden="true" /><h3>Loading route snapshot…</h3><p>The loading state is held for inspection.</p><button onClick={() => chooseScenario('incident')}>Open replay <ArrowRightIcon aria-hidden="true" /></button></div>
          : scenario === 'error' ? <div className="canvas-state"><InfoCircledIcon aria-hidden="true" /><h3>The observation source is unavailable.</h3><p>No route state can be confirmed.</p><button onClick={() => chooseScenario('incident')}>Open saved replay <ArrowRightIcon aria-hidden="true" /></button></div>
          : scenario === 'empty' ? <div className="canvas-state"><GlobeIcon aria-hidden="true" /><h3>No observations for this interval.</h3><p>Silence alone does not establish withdrawal.</p><button onClick={() => chooseScenario('incident')}>Open demo interval <ArrowRightIcon aria-hidden="true" /></button></div>
          : <RouteWeb key={scenario} routes={displayed} baseline={before} allPaths={allPaths} historical={historical} selected={selectedId} isolate={isolate} compare={compare} time={time} hidden={hidden} reducedMotion={reducedMotion} onSelect={selectRoute} />}
        <div className="coverage-bar" aria-live="polite">
          <span className={uncertain > 0 || unknown > 0 || scenario === 'stale' ? 'coverage-warning' : ''}>{unavailable ? 'Snapshot unavailable' : scenario === 'empty' ? 'No observations' : scenario === 'stale' ? 'Stale fixture · last-known state, 5 minutes old' : uncertain > 0 ? `${uncertain} uncertain · reconnect does not restore coverage` : unknown > 0 ? `${unknown} unknown · no starting baseline` : historical ? 'Collector view · RRC06' : 'Known fixture baseline'}</span>
          <span>{compare ? 'Dashed lines = baseline' : 'Lines = AS relationships'}</span>
        </div>
      </section>
      <section className="timeline" aria-label="Replay controls">
        <div className="timeline-heading"><span className="eyebrow">{mode === 'live' ? 'Simulated feed' : 'Replay'} <span className="timeline-indicator">{mode === 'live' ? liveFollowing ? 'Following' : 'Paused' : playing ? 'Playing' : 'Paused'}</span></span><code>{clock(time)}<span>UTC</span></code></div>
        <div className="timeline-track">
          <svg viewBox="0 0 1100 48" preserveAspectRatio="none" aria-hidden="true">
            <line x1="0" x2="1100" y1="34" y2="34" className="timeline-rule" />
            {Array.from({ length: 61 }, (_, i) => <line key={i} x1={i * 1100 / 60} x2={i * 1100 / 60} y1={i % 5 ? 31 : 26} y2="38" className="timeline-rule" />)}
            {!disabled && fixture.events.map((event, i) => <rect key={event.id} x={event.at / fixture.duration * 1100 - 1.5} y={event.kind === 'withdrawal' ? 4 + i % 3 * 5 : 19} width="3" height={event.kind === 'withdrawal' ? 26 - i % 3 * 5 : 13} className={event.kind === 'withdrawal' ? 'timeline-withdrawal' : event.kind.startsWith('gap') ? 'timeline-gap' : 'timeline-event'} opacity={event.at <= time ? 1 : .4} />)}
            <line x1={time / fixture.duration * 1100} x2={time / fixture.duration * 1100} y1="0" y2="44" className="timeline-cursor" />
          </svg>
          <input type="range" name="replay-position" aria-label="Replay position" aria-valuetext={`${clock(time)} UTC, ${snapshot.events.length} applied events`} min="0" max={fixture.duration} step="1" value={time} onChange={event => seek(Number(event.target.value))} disabled={disabled} />
        </div>
        <div className="timeline-labels"><span>{clock(0)}</span><span>{fixture.events.length} {historical ? 'archived' : 'synthetic'} observations</span><span>{clock(fixture.duration)} UTC</span></div>
        <div className="playback-bar">
          <div className="playback-buttons">
            <button className="icon-button restart-button" aria-label="Restart replay" disabled={disabled} onClick={() => seek(0)}><ResetIcon /></button>
            <button className="icon-button" aria-label="Previous event" disabled={disabled || time === 0} onClick={() => step(-1)}><ChevronLeftIcon /></button>
            <button className="play-button" aria-label={mode === 'live' ? liveFollowing ? 'Pause presentation' : 'Return to live demo' : playing ? 'Pause replay' : 'Play replay'} disabled={disabled} onClick={togglePlayback}>
              {(mode === 'live' ? liveFollowing : playing) ? <PauseIcon aria-hidden="true" /> : <PlayIcon aria-hidden="true" />}<span className="sr-only">{playing ? 'Pause' : 'Play'}</span>
            </button>
            <button className="icon-button" aria-label="Next event" disabled={disabled || time === fixture.duration} onClick={() => step(1)}><ChevronRightIcon /></button>
            <Dropdown label="Playback speed" value={speed} options={historical ? [{ id: '1', label: '1×' }, { id: '60', label: '60×' }, { id: '600', label: '600×' }, { id: '3600', label: '3600×' }] : [{ id: '1', label: '1×' }, { id: '2', label: '2×' }, { id: '4', label: '4×' }]} onChange={setSpeed} />
          </div>
          <span className="next-event">{disabled ? unavailable ? 'Awaiting snapshot' : 'No events' : mode === 'live' ? `Capture ${clock(capturedTime)}` : upcoming ? `${eventLabel(upcoming.kind)} · ${clock(upcoming.at)}` : 'End of replay'}</span>
          <span className="playback-status"><span className="withdrawn-count">{withdrawn}</span> withdrawn <span className="status-separator">/</span> {uncertain} uncertain</span>
        </div>
      </section>
    </main>
    <Sheet open={explorerOpen} onOpenChange={setExplorerOpen} title="Explore" description="Choose a replay. Look closer at a path." closeLabel="Close explorer"
      onCloseAutoFocus={event => { event.preventDefault(); if (!drawerOpen) explorerTrigger.current?.focus(); }}>
      <div className="panel-tabs" role="group" aria-label="Explorer view"><button aria-pressed={explorerTab === 'replay'} onClick={() => setExplorerTab('replay')}>Replay <span>01</span></button><button aria-pressed={explorerTab === 'paths'} onClick={() => setExplorerTab('paths')}>Paths <span>02</span></button></div>
      <m.div key={explorerTab} initial={{ opacity: reducedMotion ? 1 : 0, y: reducedMotion ? 0 : 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .2 }}>
        {explorerTab === 'replay' ? <div className="replay-settings">
          <div className="panel-field"><span className="eyebrow">Replay collection</span><Dropdown label="Replay collection" value={scenario} options={SCENARIOS} onChange={chooseScenario} /></div>
          <div className="panel-field"><span className="eyebrow">Observation mode</span><div className="mode-control" role="group" aria-label="Observation mode"><button aria-pressed={mode === 'replay'} onClick={() => chooseMode('replay')}>Replay</button><button aria-pressed={mode === 'live'} disabled={historical} title={historical ? 'Available in synthetic scenarios' : undefined} onClick={() => chooseMode('live')}>Live demo</button></div></div>
          <div className="panel-field"><span className="eyebrow">Reading the drawing</span><div className="legend"><span><i className="legend-line observed" />Observed AS path</span><span><i className="legend-line selected" />Selected / new record</span><span><i className="legend-line withdrawn" />Withdrawn path</span><span><i className="legend-line uncertain" />Uncertain observation</span></div></div>
          <p className="panel-note">{historical ? 'Three collector peers. One prefix. This is a saved archive, with receipt delay unrecorded.' : 'This collection is synthetic. The live demo simulates capture, including when presentation is paused.'}</p>
          <p className="panel-note">Lines follow reported AS paths. Their position is a diagram, not geography. Motion marks changes in the record.</p>
          <a className="panel-source" href="https://www.ripe.net/analyse/internet-measurements/routing-information-service-ris/" target="_blank" rel="noreferrer">RIPE RIS <ArrowRightIcon aria-hidden="true" /></a>
        </div> : <>
          <div className="observations-heading"><span className="muted">{disabled ? 0 : isolate ? 1 : displayed.length} displayed / {fixture.observers.length} available</span>
            <Modal title="Choose observers" description="Display up to 6 paths. Clear a selected observer to make room." trigger={<button className="icon-button" aria-label="Choose observers" disabled={disabled}><MixerHorizontalIcon aria-hidden="true" /></button>}>
              <span className="selection-count" aria-live="polite">{observerIds.length} of 6 selected / {fixture.observers.length} available</span>
              <div className="observer-choices">{fixture.observers.slice(observerPage * 12, observerPage * 12 + 12).map(observer => <label key={observer.id}>
                <input type="checkbox" name="observer" value={observer.id} checked={observerIds.includes(observer.id)} disabled={!observerIds.includes(observer.id) && observerIds.length >= 6}
                  onChange={event => { setObserverIds(ids => event.target.checked ? [...ids, observer.id] : ids.filter(id => id !== observer.id)); setIsolate(null); }} />
                <span>{observer.city}<small>{observer.collector} · AS{observer.asn}</small></span>
              </label>)}</div>
              {fixture.observers.length > 12 && <div className="choice-pagination"><button onClick={() => setObserverPage(p => p - 1)} disabled={observerPage === 0}>Previous</button><span>Page {observerPage + 1} / {Math.ceil(fixture.observers.length / 12)}</span><button onClick={() => setObserverPage(p => p + 1)} disabled={(observerPage + 1) * 12 >= fixture.observers.length}>Next</button></div>}
              <Dialog.Close className="primary-button">Done <CheckIcon aria-hidden="true" /></Dialog.Close>
            </Modal>
          </div>
          <div className="route-list">{!disabled && displayed.filter(route => !isolate || route.observer.id === isolate).map(route => <button key={route.observer.id} className={`route-row ${selectedId === route.observer.id ? 'selected-row' : ''}`} onClick={event => selectRoute(route.observer.id, event.currentTarget)}>
            <span className="route-observer">{route.observer.city}<small>{route.observer.collector} · {route.observer.peer}</small></span>
            <span className={`route-status ${route.status}`}>{routeLabel(route.status)}</span>
            <span className="route-as-path">{route.path.length ? route.path.map(asn => `AS${asn}`).join(' → ') : route.status === 'unknown' ? 'No baseline acquired' : 'No current observed path'}</span>
            <ChevronRightIcon aria-hidden="true" />
          </button>)}{!disabled && displayed.length === 0 && <p className="no-observers">Choose an observer to display its path.</p>}{disabled && <p className="no-observers">{scenario === 'empty' ? 'No observers in this interval.' : 'Paths appear when a snapshot is available.'}</p>}</div>
        </>}
      </m.div>
    </Sheet>
    <Sheet open={drawerOpen && !!selected} onOpenChange={setDrawerOpen} title="Route evidence" description={`${selected?.observer.city} at ${clock(time)} UTC`} side="right" className="evidence-drawer" closeLabel="Close evidence"
      onCloseAutoFocus={event => { event.preventDefault(); if (evidenceTrigger.current?.isConnected) evidenceTrigger.current.focus(); else pathsTrigger.current?.focus(); }}>
      {selected && <>
        <div className={`evidence-status ${selected.status}`}>{routeLabel(selected.status)}</div>
        <h4 className="eyebrow">At replay position</h4><PathText path={selected.path} />
        <dl className="evidence-details"><div><dt>Prefix</dt><dd><code>{PREFIX}</code></dd></div><div><dt>Collector</dt><dd>{selected.observer.collector}</dd></div><div><dt>Peer</dt><dd><code>{selected.observer.peer} · AS{selected.observer.asn}</code></dd></div><div><dt>Latest evidence</dt><dd>{selected.lastEvent ? eventLabel(selected.lastEvent.kind) : historical ? 'Reconstructed baseline' : selected.observer.baseline ? 'Fixture baseline' : 'No baseline'}</dd></div><div><dt>Source time</dt><dd><code>{selectedEvidence?.sourceTime ?? `${clock(selected.lastEvent?.at ?? 0)} UTC`}</code></dd></div><div><dt>Receipt delay</dt><dd>{historical ? 'Not recorded in MRT' : '180 ms (simulated)'}</dd></div><div><dt>Coverage</dt><dd>{selected.gapOpen ? 'Capture gap open' : selected.status === 'uncertain' ? 'Reconnected; state still uncertain' : selected.status === 'unknown' ? 'Baseline not acquired' : historical ? 'Reconstructed collector state' : 'Known fixture state'}</dd></div></dl>
        <details className="path-comparison"><summary>Earlier paths</summary><h4>Starting baseline</h4><PathText path={selectedBaseline?.path ?? []} fallback={selectedBaseline?.status === 'withdrawn' ? 'Withdrawn before replay start' : 'Unknown starting baseline'} /><h4>Before latest route change</h4><PathText path={selected.previousPath} fallback="No earlier observed path" /></details>
        <button className="isolate-button" aria-pressed={isolate === selectedId} onClick={() => { setIsolate(isolate === selectedId ? null : selectedId); setDrawerOpen(false); }}>{isolate === selectedId ? 'Show all observers' : 'Isolate this observer'}<ArrowRightIcon aria-hidden="true" /></button>
        {historical && selectedEvidence && <a className="archive-link" href={`https://data.ris.ripe.net/rrc06/2021.10/${selectedEvidence.archive}`} target="_blank" rel="noreferrer">Open supporting MRT archive <ArrowRightIcon aria-hidden="true" /></a>}
        <details className="record-disclosure"><summary>{historical ? 'Supporting archive record' : 'Supporting fixture record'}</summary><pre className="evidence-record">{JSON.stringify(historical ? { source: 'RIPE NCC RIS', eventId: selected.lastEvent?.id ?? `baseline:${selected.observer.id}`, ...selectedEvidence, projectionCursor: snapshot.cursor } : { source: 'synthetic-fixture', eventId: selected.lastEvent?.id ?? `baseline:${selected.observer.id}`, collector: selected.observer.collector, peer: selected.observer.peer, prefix: PREFIX, kind: selected.lastEvent?.kind ?? (selected.observer.baseline ? 'baseline' : 'unknown'), sourceTime: new Date(START + (selected.lastEvent?.at ?? 0) * 1000).toISOString(), receivedAt: new Date(START + (selected.lastEvent?.at ?? 0) * 1000 + 180).toISOString(), path: selected.lastEvent?.path ?? selected.path, projectionCursor: snapshot.cursor }, null, 2)}</pre></details>
        <p className="evidence-note">{historical ? 'Decoded with pybgpkit-parser 0.18.0. RIB raw timestamps record when a prefix was heard; sourceTime records table capture. Evidence covers these collector peers only.' : 'Synthetic evidence. It does not establish what a real collector observed.'}</p>
      </>}
    </Sheet>
  </>;
}
