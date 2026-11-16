'use client';
import { useMemo, useRef, useState } from 'react';
import type { GeographicFeature, TerritoryGeography } from '@contracts';

const polygons = (feature: GeographicFeature) => feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
export function TerritoryMap({ geography, selected, onSelect, scientific = false }: { geography: TerritoryGeography; selected?: string; onSelect: (id: string) => void; scientific?: boolean }) {
  const [zoom, setZoom] = useState(1), [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; origin: typeof pan } | undefined>(undefined);
  const map = useMemo(() => {
    const points = geography.features.flatMap(f => polygons(f).flat(2));
    if (!points.length) return undefined;
    const bounds = points.reduce((b, p) => ({ xmin: Math.min(b.xmin, p[0]!), xmax: Math.max(b.xmax, p[0]!), ymin: Math.min(b.ymin, p[1]!), ymax: Math.max(b.ymax, p[1]!) }), { xmin: Infinity, xmax: -Infinity, ymin: Infinity, ymax: -Infinity });
    const { xmin, xmax, ymin, ymax } = bounds;
    const aspect = Math.cos((ymin + ymax) / 2 * Math.PI / 180);
    const width = Math.max((xmax - xmin) * aspect, .0001), height = Math.max(ymax - ymin, .0001);
    const scale = 440 / Math.max(width, height);
    const project = (point: number[]) => [300 + (point[0]! - (xmin + xmax) / 2) * aspect * scale, 250 - (point[1]! - (ymin + ymax) / 2) * scale];
    return geography.features.map(feature => {
      const ring = polygons(feature)[0]![0]!;
      const center = ring.slice(0, -1).reduce((c, p) => [c[0]! + p[0]! / (ring.length - 1), c[1]! + p[1]! / (ring.length - 1)], [0, 0]);
      return { feature, label: project(center), path: polygons(feature).map(poly => poly.map(ring => ring.map((point, index) => `${index ? 'L' : 'M'}${project(point).join(',')}`).join(' ') + 'Z').join(' ')).join(' ') };
    });
  }, [geography]);
  return <div className="territory-map">
    <div className="map-controls" role="group" aria-label="Déplacement de la carte"><button aria-label="Agrandir la carte" disabled={zoom >= 4} onClick={() => setZoom(v => Math.min(4, v * 1.5))}>+</button><button aria-label="Réduire la carte" disabled={zoom <= 1} onClick={() => setZoom(v => Math.max(1, v / 1.5))}>−</button><button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>Recentrer</button></div>
    <svg viewBox={`${300 - 300 / zoom + pan.x} ${250 - 250 / zoom + pan.y} ${600 / zoom} ${500 / zoom}`} aria-label={geography.name} role="group"
      onPointerDown={e => { if (e.target === e.currentTarget) { drag.current = { x: e.clientX, y: e.clientY, origin: pan }; e.currentTarget.setPointerCapture(e.pointerId); } }}
      onPointerMove={e => { if (drag.current) { const rect = e.currentTarget.getBoundingClientRect(); setPan({ x: drag.current.origin.x - (e.clientX - drag.current.x) * 600 / rect.width / zoom, y: drag.current.origin.y - (e.clientY - drag.current.y) * 500 / rect.height / zoom }); } }} onPointerUp={() => { drag.current = undefined; }} onPointerCancel={() => { drag.current = undefined; }}>
      <title>{geography.name}</title>
      {map?.filter(row => row.feature.properties.role === 'lake').map(({ feature, path }) => <path key={feature.properties.id} d={path} className="lake-outline" fillRule="evenodd" />)}
      {map?.filter(row => row.feature.properties.role === 'zone').map(({ feature, path }) => <path key={feature.properties.id} d={path} fillRule="evenodd" role="button" tabIndex={0} aria-label={`Sur la carte : ${feature.properties.name}`} aria-pressed={selected === feature.properties.id} className={`fishing-zone${selected === feature.properties.id ? ' selected-zone' : ''}`} onClick={() => onSelect(feature.properties.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(feature.properties.id); } }}><title>{feature.properties.name}{selected === feature.properties.id ? ' · sélectionnée ✓' : ''}</title></path>)}
      {map?.filter(row => row.feature.properties.role === 'zone').map(({ feature, label }) => <text key={`label-${feature.properties.id}`} className="map-zone-label" aria-hidden="true" x={label[0]} y={label[1]} textAnchor="middle" dominantBaseline="middle">{selected === feature.properties.id ? '✓ ' : ''}{feature.properties.name}</text>)}
    </svg>
    <p className="map-caption">{scientific ? 'Coordonnées WGS84 · Vue indicative · Sélection : contour épais en pointillés.' : 'Choisissez une zone sur la carte.'}</p>
  </div>;
}
