import { useEffect, useMemo, useRef, useState } from 'react';
import { select } from 'd3-selection';
import { curveMonotoneX, line } from 'd3-shape';
import { zoom, zoomIdentity, type ZoomBehavior } from 'd3-zoom';
import { animate } from 'animejs';
import { MinusIcon, PlusIcon, ResetIcon } from '@radix-ui/react-icons';
import { PREFIX, routeLabel, supportedEdges, type RouteState } from './replay';

type Point = [number, number];
type Nodes = Record<number, { point: Point; name: string }>;
const fixtureNodes: Nodes = {
  64520: { point: [465, 90], name: 'Transit A' },
  64521: { point: [495, 180], name: 'Transit B' },
  64522: { point: [465, 275], name: 'Transit C' },
  64530: { point: [750, 135], name: 'Transit D' },
  64540: { point: [770, 245], name: 'Transit E' },
  32934: { point: [1010, 180], name: 'Destination origin' },
};
// Use every path in the interval, so later announcements cannot move a node.
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
    asns.forEach((asn, i) => {
      nodes[asn] = { point: [390 + (maximum - hop) / maximum * 520, 75 + (i + .5) / asns.length * 230], name: 'Observed AS' };
    });
  }
  return nodes;
}
const curve = line<Point>().x(p => p[0]).y(p => p[1]).curve(curveMonotoneX);

function segment(a: Point, b: Point, offset = 0) {
  return curve([a, [a[0] + (b[0] - a[0]) * .38, a[1] + offset],
    [a[0] + (b[0] - a[0]) * .64, b[1] + offset], b]) ?? '';
}

function routePath(path: number[], slot: number, nodes: Nodes) {
  const points: Point[] = [[185, 45 + slot * 54], ...path.slice(1).map(asn => nodes[asn]?.point).filter((p): p is Point => !!p)];
  return points.slice(1).map((point, i) => segment(points[i], point, (slot - 2.5) * 5)).join(' ');
}

export default function RouteWeb({ routes, baseline, allPaths, historical, selected, isolate, compare, time, reducedMotion, hidden, onSelect }: {
  routes: RouteState[]; baseline: RouteState[]; selected: string | null; isolate: string | null;
  allPaths: number[][]; historical: boolean;
  compare: boolean; time: number; reducedMotion: boolean; hidden: boolean; onSelect: (id: string, trigger?: SVGElement) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const groupRef = useRef<SVGGElement>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const slots = useRef(new Map<string, number>());
  const [zoomValue, setZoomValue] = useState(1);
  const nodes = useMemo(() => layoutNodes(allPaths, historical), [allPaths, historical]);
  const lastEvents = useRef(new Map(routes.map(r => [r.observer.id, r.lastEvent?.id])));
  const changed = new Set(routes.filter(r => r.lastEvent?.id !== lastEvents.current.get(r.observer.id)).map(r => r.observer.id));
  useEffect(() => { lastEvents.current = new Map(routes.map(r => [r.observer.id, r.lastEvent?.id])); }, [routes]);
  for (const id of slots.current.keys()) if (!routes.some(r => r.observer.id === id)) slots.current.delete(id);
  for (const route of routes) {
    if (!slots.current.has(route.observer.id)) {
      const used = [...slots.current.values()];
      slots.current.set(route.observer.id, [0, 1, 2, 3, 4, 5].find(i => !used.includes(i)) ?? 0);
    }
  }
  const visible = useMemo(() => routes.filter(r => !isolate || r.observer.id === isolate), [routes, isolate]);
  const edges = supportedEdges(visible);
  const activeAsns = new Set(visible.flatMap(r => r.path.slice(1)));

  useEffect(() => {
    if (!svgRef.current || !groupRef.current) return;
    const svg = select(svgRef.current);
    const behavior = zoom<SVGSVGElement, unknown>()
      .extent([[0, 0], [1200, 380]]).scaleExtent([.65, 2.5])
      .translateExtent([[-400, -300], [1600, 900]])
      .filter(event => !event.target.closest('[role="button"]') && (event.type !== 'wheel' || event.ctrlKey))
      .on('zoom', event => {
        groupRef.current?.setAttribute('transform', event.transform.toString());
        setZoomValue(event.transform.k);
      });
    zoomRef.current = behavior;
    svg.call(behavior).on('dblclick.zoom', null);
    return () => { svg.on('.zoom', null); };
  }, []);

  useEffect(() => {
    if (!groupRef.current) return;
    const entering = groupRef.current.querySelectorAll<SVGPathElement>('[data-transition="enter"]');
    const leaving = groupRef.current.querySelectorAll<SVGPathElement>('[data-transition="leave"]');
    if (reducedMotion || hidden) {
      entering.forEach(el => { el.style.opacity = ''; });
      leaving.forEach(el => { el.style.opacity = '0'; });
      return;
    }
    const animations = [
      ...(entering.length ? [animate(entering, { opacity: [0.35, 1], duration: 350, ease: 'outQuad' })] : []),
      ...(leaving.length ? [animate(leaving, { opacity: [.85, 0], duration: 350, ease: 'outQuad' })] : []),
    ];
    return () => { animations.forEach(animation => animation.revert()); };
  }, [time, reducedMotion, hidden, compare, isolate, routes]);

  function scale(factor: number) {
    if (svgRef.current && zoomRef.current) select(svgRef.current).call(zoomRef.current.scaleBy, factor);
  }
  function reset() {
    if (svgRef.current && zoomRef.current) select(svgRef.current).call(zoomRef.current.transform, zoomIdentity);
  }

  return <div className="route-canvas">
    <div className="diagram-columns" aria-hidden="true"><span>Observation points</span><span>Observed network relationships</span><span>Destination</span></div>
    <svg ref={svgRef} viewBox="0 0 1200 380" className="route-svg" role="group" tabIndex={0}
      aria-label="Interactive route web. Arrow keys pan, plus and minus zoom, Home resets. The route list below provides complete textual evidence."
      onKeyDown={event => {
        if (event.target !== event.currentTarget || !svgRef.current || !zoomRef.current) return;
        const delta = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] }[event.key];
        if (delta) { event.preventDefault(); select(svgRef.current).call(zoomRef.current.translateBy, delta[0], delta[1]); }
        else if (event.key === '+' || event.key === '=') { event.preventDefault(); scale(1.25); }
        else if (event.key === '-') { event.preventDefault(); scale(.8); }
        else if (event.key === 'Home') { event.preventDefault(); reset(); }
      }}>
      <defs><pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".8" fill="#29323b" /></pattern></defs>
      <rect width="1200" height="380" fill="url(#grid)" opacity=".45" aria-hidden="true" />
      <g ref={groupRef}>
        <g aria-hidden="true" className="shared-edges">
          {edges.filter(e => nodes[e.from] && nodes[e.to]).map(edge => <path
            key={`${edge.from}:${edge.to}`} d={segment(nodes[edge.from].point, nodes[edge.to].point)}
            data-shared-edge={`${edge.from}:${edge.to}`} data-support={edge.observers.length}
            className={edge.observers.length ? 'shared-edge' : 'uncertain-edge'} />)}
        </g>
        {compare && baseline.filter(r => !isolate || r.observer.id === isolate).map(route => <path
          key={`before-${route.observer.id}`} d={routePath(route.path, slots.current.get(route.observer.id) ?? 0, nodes)}
          className="comparison-path" aria-hidden="true" />)}
        {visible.map(route => {
          const slot = slots.current.get(route.observer.id) ?? 0;
          const isSelected = selected === route.observer.id;
          const recent = route.lastEvent && changed.has(route.observer.id);
          const withdrawn = route.status === 'withdrawn';
          const path = route.path.length ? route.path : route.previousPath;
          const d = routePath(path, slot, nodes);
          return <g key={route.observer.id} data-observer={route.observer.id}>
            {recent && route.previousPath.length > 0 && route.lastEvent?.kind === 'path-change' && <path
              d={routePath(route.previousPath, slot, nodes)} className="withdrawal-path" data-transition="leave" aria-hidden="true" />}
            {path.length > 0 && <>
              <path d={d} className={`observer-path ${isSelected ? 'selected-path' : ''} ${route.status === 'uncertain' ? 'uncertain-path' : ''} ${withdrawn ? 'withdrawal-path' : ''} ${recent && !withdrawn ? 'new-path' : ''}`}
                data-route-state={route.status} data-transition={recent ? withdrawn ? 'leave' : 'enter' : undefined}
                style={withdrawn && !recent ? { opacity: 0 } : undefined} aria-hidden="true" />
              {!withdrawn && <path d={d} className="route-hit-target" role="button" tabIndex={0}
                aria-label={`Inspect ${route.observer.city} route, ${routeLabel(route.status)}`}
                onClick={event => onSelect(route.observer.id, event.currentTarget)} onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(route.observer.id, event.currentTarget); }
                }} />}
            </>}
            <g transform={`translate(185 ${45 + slot * 54})`} className={`observer-node ${isSelected ? 'selected-node' : ''}`}
              role="button" tabIndex={0} aria-label={`Inspect ${route.observer.city}, ${routeLabel(route.status)}`}
              onClick={event => onSelect(route.observer.id, event.currentTarget)} onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(route.observer.id, event.currentTarget); }
              }}>
              <rect x="-168" y="-30" width="196" height="61" fill="transparent" />
              <circle r="6" className={`node-dot ${route.status}`} />
              <text x="-22" y="-1" textAnchor="end" className="observer-city">{route.observer.city}</text>
              <text x="-22" y="18" textAnchor="end" className="node-detail">AS{route.observer.asn} · {slot + 1 < 10 ? '0' : ''}{slot + 1}</text>
              {route.status === 'withdrawn' && <text x="18" y="5" className="withdrawn-note">withdrawn</text>}
              {route.status === 'unknown' && <text x="18" y="5" className="unknown-note">unknown baseline</text>}
              {route.status === 'uncertain' && <text x="18" y="5" className="uncertain-note">coverage gap</text>}
            </g>
          </g>;
        })}
        {Object.entries(nodes).filter(([asn]) => Number(asn) !== 32934).map(([asn, node]) => <g
          key={asn} data-asn={asn} transform={`translate(${node.point.join(' ')})`} aria-hidden="true" className={activeAsns.has(Number(asn)) ? 'network-node' : 'network-node inactive-node'}>
          <circle r="17" className="node-halo" /><circle r="5" className="transit-dot" />
          <text x="0" y={historical ? -22 : -29} textAnchor="middle" className="node-asn">AS{asn}</text>
          {!historical && <text x="0" y="-46" textAnchor="middle" className="node-detail">{node.name}</text>}
        </g>)}
        <g transform="translate(1010 180)" aria-hidden="true" className="destination-node">
          <circle r="34" className="destination-ring" /><circle r="22" className="destination-inner" /><circle r="7" className="destination-dot" />
          <text x="0" y="-57" textAnchor="middle" className="destination-name">Facebook</text>
          <text x="0" y="-39" textAnchor="middle" className="node-detail">AS32934</text>
          <text x="0" y="63" textAnchor="middle" className="prefix-label">{PREFIX}</text>
          <text x="0" y="83" textAnchor="middle" className="node-detail">Selected prefix</text>
        </g>
      </g>
    </svg>
    <div className="diagram-bottom">
      <span className="diagram-hint">Drag to pan · Ctrl + scroll to zoom</span>
      <div className="zoom-controls">
        <button className="icon-button" aria-label="Zoom out" onClick={() => scale(.8)}><MinusIcon /></button>
        <output aria-label="Zoom level">{Math.round(zoomValue * 100)}%</output>
        <button className="icon-button" aria-label="Zoom in" onClick={() => scale(1.25)}><PlusIcon /></button>
        <button className="icon-button" aria-label="Reset view" onClick={reset}><ResetIcon /></button>
      </div>
    </div>
  </div>;
}
