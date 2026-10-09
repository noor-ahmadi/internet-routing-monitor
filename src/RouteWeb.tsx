import { useEffect, useMemo, useRef, useState } from 'react';
import { select } from 'd3-selection';
import { zoom, zoomIdentity, type ZoomBehavior } from 'd3-zoom';
import { useAnimationControls } from 'motion/react';
import * as m from 'motion/react-m';
import { MinusIcon, PlusIcon, ResetIcon } from '@radix-ui/react-icons';
import { PREFIX, routeLabel, supportedEdges, type RouteState } from './replay';

type Point = [number, number];
type Nodes = Record<number, Point>;
const fixtureNodes: Nodes = {
  64520: [465, 105], 64521: [495, 220], 64522: [465, 345],
  64530: [770, 155], 64540: [770, 320], 32934: [1050, 230],
};

// All paths in the interval participate in layout. Replay cannot rearrange ASs.
function layoutNodes(paths: number[][], historical: boolean): Nodes {
  if (!historical) return fixtureNodes;
  const depth = new Map<number, number>();
  for (const path of paths) for (let i = 1; i < path.length - 1; i++) {
    depth.set(path[i], Math.max(depth.get(path[i]) ?? 0, path.length - 1 - i));
  }
  const maximum = Math.max(1, ...depth.values());
  const nodes: Nodes = { 32934: fixtureNodes[32934] };
  for (let hop = 1; hop <= maximum; hop++) {
    const asns = [...depth].filter(([, distance]) => distance === hop).map(([asn]) => asn).sort((a, b) => a - b);
    asns.forEach((asn, i) => { nodes[asn] = [470 + (maximum - hop) / maximum * 500, 75 + (i + .5) / asns.length * 310]; });
  }
  return nodes;
}

function segment(a: Point, b: Point, vertical: boolean, offset = 0) {
  const [ax, ay] = a, [bx, by] = b;
  return vertical
    ? `M${ax},${ay} C${ax + offset},${ay + (by - ay) * .5} ${bx + offset},${by - (by - ay) * .5} ${bx},${by}`
    : `M${ax},${ay} C${ax + (bx - ax) * .5},${ay + offset} ${bx - (bx - ax) * .5},${by + offset} ${bx},${by}`;
}

function Trace({ route, d, selected, reducedMotion, hidden }: {
  route: RouteState; d: string; selected: boolean; reducedMotion: boolean; hidden: boolean;
}) {
  const controls = useAnimationControls();
  const lastEvent = useRef(route.lastEvent?.id);
  const withdrawn = route.status === 'withdrawn';
  const color = withdrawn ? '#f39a85' : route.status === 'uncertain' ? '#d7be90' : selected ? '#d7f58a' : '#a8aca0';
  useEffect(() => {
    const changed = lastEvent.current !== route.lastEvent?.id;
    lastEvent.current = route.lastEvent?.id;
    controls.stop();
    const final = { opacity: withdrawn ? 0 : 1, stroke: color };
    if (reducedMotion || hidden || !changed) controls.set(route.status === 'observed' ? { ...final, pathLength: 1 } : final);
    else if (withdrawn) {
      controls.set({ opacity: .9, stroke: color });
      void controls.start({ opacity: 0, transition: { duration: .65, ease: 'easeOut' } });
    } else if (route.status === 'uncertain') {
      controls.set({ opacity: .5, stroke: color });
      void controls.start({ opacity: 1, transition: { duration: .35 } });
    } else {
      controls.set({ opacity: .4, pathLength: 0, stroke: '#d7f58a' });
      void controls.start({ opacity: 1, pathLength: 1, stroke: color, transition: { duration: .65, ease: [.22, 1, .36, 1] } });
    }
    return () => controls.stop();
  }, [route.lastEvent?.id, route.status, color, withdrawn, reducedMotion, hidden, controls]);
  // A fresh element prevents normalized drawing lengths from stretching gap dashes.
  return <m.path key={route.status} d={d} stroke={color} initial={false} animate={controls} aria-hidden="true"
    className={`observer-path ${selected ? 'selected-path' : ''} ${route.status === 'uncertain' ? 'uncertain-path' : ''} ${withdrawn ? 'withdrawal-path' : ''}`}
    data-route-state={route.status} />;
}

export default function RouteWeb({ routes, baseline, allPaths, historical, selected, isolate, compare, reducedMotion, hidden, onSelect }: {
  routes: RouteState[]; baseline: RouteState[]; selected: string | null; isolate: string | null;
  allPaths: number[][]; historical: boolean; compare: boolean; time: number;
  reducedMotion: boolean; hidden: boolean; onSelect: (id: string, trigger?: SVGElement) => void;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const groupRef = useRef<SVGGElement>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const slots = useRef(new Map<string, number>());
  const initialCount = useRef(routes.length);
  const [compact, setCompact] = useState(window.innerWidth < 700);
  const [zoomValue, setZoomValue] = useState(1);
  const nodes = useMemo(() => layoutNodes(allPaths, historical), [allPaths, historical]);
  const width = compact ? 500 : 1200, height = compact ? 700 : 330;
  const point = (p: Point): Point => compact ? [40 + p[1] * .88, p[0] * .52] : [p[0], 12 + p[1] * .66];
  const observerPoint = (slot: number): Point => point([210, initialCount.current === 3 ? 120 + slot * 110 : 80 + slot * 60]);
  for (const id of slots.current.keys()) if (!routes.some(r => r.observer.id === id)) slots.current.delete(id);
  for (const route of routes) if (!slots.current.has(route.observer.id)) {
    const used = [...slots.current.values()];
    slots.current.set(route.observer.id, [0, 1, 2, 3, 4, 5].find(i => !used.includes(i)) ?? 0);
  }
  const visible = routes.filter(r => !isolate || r.observer.id === isolate);
  const edges = supportedEdges(visible);
  const activeAsns = new Set(visible.filter(r => r.status === 'observed').flatMap(r => r.path.slice(1)));
  const uncertainAsns = new Set(visible.filter(r => r.status === 'uncertain').flatMap(r => r.path.slice(1)));
  const shared = edges.find(e => e.observers.length > 1 && nodes[e.from] && nodes[e.to]);
  const annotated = visible.find(r => r.observer.id === selected && r.path.length) ?? visible.find(r => r.path.length);

  function pathFor(path: number[], slot: number) {
    const points = [observerPoint(slot), ...path.slice(1).map(asn => nodes[asn] && point(nodes[asn])).filter((p): p is Point => !!p)];
    return points.slice(1).map((p, i) => segment(points[i], p, compact, (slot - 2.5) * 3)).join(' ');
  }

  useEffect(() => {
    if (!canvasRef.current) return;
    const resize = new ResizeObserver(([entry]) => setCompact(entry.contentRect.width < 700));
    resize.observe(canvasRef.current);
    return () => resize.disconnect();
  }, []);

  useEffect(() => {
    if (!svgRef.current || !groupRef.current) return;
    const svg = select(svgRef.current);
    const behavior = zoom<SVGSVGElement, unknown>()
      .extent([[0, 0], [width, height]]).scaleExtent([.65, 2.5])
      .translateExtent([[-400, -300], [width + 400, height + 500]])
      .filter(event => !event.target.closest('[role="button"]') && (event.type !== 'wheel' || event.ctrlKey))
      .on('zoom', event => { groupRef.current?.setAttribute('transform', event.transform.toString()); setZoomValue(event.transform.k); });
    zoomRef.current = behavior;
    svg.call(behavior).on('dblclick.zoom', null).call(behavior.transform, zoomIdentity);
    return () => { svg.on('.zoom', null); };
  }, [width, height]);

  function scale(factor: number) { if (svgRef.current && zoomRef.current) select(svgRef.current).call(zoomRef.current.scaleBy, factor); }
  function reset() { if (svgRef.current && zoomRef.current) select(svgRef.current).call(zoomRef.current.transform, zoomIdentity); }
  const inspectKeys = (id: string) => (event: React.KeyboardEvent<SVGElement>) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(id, event.currentTarget); }
  };

  return <div ref={canvasRef} className={`route-canvas ${compact ? 'compact-canvas' : ''}`}>
    <svg ref={svgRef} viewBox={`0 0 ${width} ${height}`} className="route-svg" role="group" tabIndex={0}
      aria-label="Interactive route web. Arrow keys pan, plus and minus zoom, Home resets. Open Observers for complete textual paths and evidence."
      onKeyDown={event => {
        if (event.target !== event.currentTarget || !svgRef.current || !zoomRef.current) return;
        const delta = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] }[event.key];
        if (delta) { event.preventDefault(); select(svgRef.current).call(zoomRef.current.translateBy, delta[0], delta[1]); }
        else if (event.key === '+' || event.key === '=') { event.preventDefault(); scale(1.25); }
        else if (event.key === '-') { event.preventDefault(); scale(.8); }
        else if (event.key === 'Home') { event.preventDefault(); reset(); }
      }}>
      <g ref={groupRef}>
        <m.g initial={{ opacity: reducedMotion || hidden ? 1 : 0 }} animate={{ opacity: 1 }} transition={{ duration: reducedMotion || hidden ? 0 : .6 }}>
          <g aria-hidden="true" className="diagram-guides">
            {compact ? <><line x1="38" x2="462" y1="203" y2="203" /><line x1="38" x2="462" y1="487" y2="487" /></>
              : <><line x1="340" x2="340" y1="10" y2="310" /><line x1="955" x2="955" y1="10" y2="310" /></>}
          </g>
          <g aria-hidden="true" className="shared-edges">{edges.filter(e => nodes[e.from] && nodes[e.to]).map(edge => <path key={`${edge.from}:${edge.to}`}
            d={segment(point(nodes[edge.from]), point(nodes[edge.to]), compact)} data-shared-edge={`${edge.from}:${edge.to}`} data-support={edge.observers.length} className={edge.observers.length ? 'shared-edge' : 'uncertain-edge'} />)}</g>
          {compare && baseline.filter(r => !isolate || r.observer.id === isolate).map(route => <path key={`before-${route.observer.id}`} d={pathFor(route.path, slots.current.get(route.observer.id) ?? 0)} className="comparison-path" aria-hidden="true" />)}
          {visible.map(route => {
            const slot = slots.current.get(route.observer.id) ?? 0, isSelected = selected === route.observer.id;
            const p = observerPoint(slot), path = route.path.length ? route.path : route.previousPath;
            const d = pathFor(path, slot);
            const cityLabel = historical ? `AS${route.observer.asn}` : route.observer.city;
            const detailLabel = historical ? route.observer.collector.toUpperCase() : `AS${route.observer.asn}`;
            const statusNote = route.status === 'observed' ? '' : route.status === 'uncertain' ? 'gap' : route.status;
            return <g key={route.observer.id} data-observer={route.observer.id}>
              <Trace route={route} d={d} selected={isSelected} reducedMotion={reducedMotion} hidden={hidden} />
              {path.length > 0 && route.status !== 'withdrawn' && <path d={d} className="route-hit-target" role="button" tabIndex={0} aria-label={`Inspect ${route.observer.city} route, ${routeLabel(route.status)}`} onClick={event => onSelect(route.observer.id, event.currentTarget)} onKeyDown={inspectKeys(route.observer.id)} />}
              <g transform={`translate(${p.join(' ')})`} className={`observer-node ${isSelected ? 'selected-node' : ''}`} role="button" tabIndex={0}
                aria-label={`Inspect ${cityLabel} ${detailLabel}${statusNote ? ` ${statusNote}` : ''}, ${routeLabel(route.status)}`} onClick={event => onSelect(route.observer.id, event.currentTarget)} onKeyDown={inspectKeys(route.observer.id)}>
                <rect x={compact ? -34 : -185} y={compact ? -60 : -29} width={compact ? 68 : 214} height={compact ? 86 : 65} fill="transparent" />
                <circle r="5" className={`node-dot ${route.status}`} />
                <text x={compact ? 0 : -22} y={compact ? -30 : 0} textAnchor={compact ? 'middle' : 'end'} className={`observer-city ${compact && visible.length > 3 ? 'small-city' : ''}`}>{cityLabel}</text>{' '}
                <text x={compact ? 0 : -22} y={compact ? -12 : 20} textAnchor={compact ? 'middle' : 'end'} className="node-detail">{detailLabel}</text>{' '}
                {statusNote && <text x={compact ? 0 : 18} y={compact ? 28 : 6} textAnchor={compact ? 'middle' : 'start'} className={`${route.status}-note`}>{statusNote}</text>}
              </g>
            </g>;
          })}
          {Object.entries(nodes).filter(([asn]) => Number(asn) !== 32934).map(([asn, p]) => <g key={asn} data-asn={asn} transform={`translate(${point(p).join(' ')})`} aria-hidden="true" className={`network-node ${activeAsns.has(Number(asn)) ? '' : uncertainAsns.has(Number(asn)) ? 'uncertain-node' : 'inactive-node'}`}>
            <circle r="14" className="node-halo" /><circle r="3.5" className="transit-dot" />
            <text x="0" y="-19" textAnchor="middle" className="node-asn">AS{asn}</text>
          </g>)}
          {annotated && (() => {
            const p = observerPoint(slots.current.get(annotated.observer.id) ?? 0), next = point(nodes[annotated.path[1]] ?? nodes[32934]);
            const x = compact ? p[0] - 24 : p[0] + (next[0] - p[0]) * (next[0] - p[0] < 450 ? .75 : .22);
            const y = compact ? p[1] + (next[1] - p[1]) * .23 : p[1] - 34;
            return <g className="line-annotation" aria-hidden="true"><text x={x} y={y} textAnchor={compact ? 'end' : 'middle'}>{annotated.status === 'uncertain' ? 'last known path' : 'observed AS path'}</text><text x={x} y={y + 18} textAnchor={compact ? 'end' : 'middle'} className="annotation-detail">{annotated.path.length - 1} {annotated.path.length === 2 ? 'hop' : 'hops'}</text></g>;
          })()}
          {shared && !compact && (() => {
            const a = point(nodes[shared.from]), b = point(nodes[shared.to]);
            return <text x={(a[0] + b[0]) / 2} y={(a[1] + b[1]) / 2 + 28} className="shared-label" textAnchor="middle" aria-hidden="true">shared · {shared.observers.length} peers</text>;
          })()}
          <g transform={`translate(${point(nodes[32934]).join(' ')})`} aria-hidden="true" className={`destination-node ${activeAsns.has(32934) ? '' : uncertainAsns.has(32934) ? 'uncertain-destination' : 'quiet-destination'}`}>
            <circle r="29" className="destination-ring" /><circle r="7" className="destination-dot" />
            <text x="0" y={compact ? 62 : -63} textAnchor="middle" className="destination-name">Facebook</text>
            <text x="0" y={compact ? 88 : -35} textAnchor="middle" className="node-detail">AS32934 / origin</text>
            <text x="0" y={compact ? 110 : 66} textAnchor="middle" className="prefix-label">{PREFIX}</text>
          </g>
          {visible.length > 0 && visible.every(r => r.status === 'withdrawn') && <text x={compact ? 250 : 605} y={compact ? 450 : 165} textAnchor="middle" className="quiet-label" aria-hidden="true">No observed path.</text>}
        </m.g>
      </g>
    </svg>
    <div className="diagram-bottom"><span className="diagram-hint">{compact ? 'Tap a point to inspect' : 'Pick a path. Follow the evidence.'}</span><div className="zoom-controls">
      <button className="icon-button" aria-label="Zoom out" onClick={() => scale(.8)}><MinusIcon /></button><output aria-label="Zoom level">{Math.round(zoomValue * 100)}%</output>
      <button className="icon-button" aria-label="Zoom in" onClick={() => scale(1.25)}><PlusIcon /></button><button className="icon-button" aria-label="Reset view" onClick={reset}><ResetIcon /></button>
    </div></div>
  </div>;
}
