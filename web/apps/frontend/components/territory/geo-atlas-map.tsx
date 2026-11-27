'use client';
import { useId, useMemo, useRef, useState } from 'react';
import { geometryPoints, type GeoAtlasFeature, type GeoGeometry, type Position } from '../../../../packages/contracts/geo-atlas';
export type DrawMode = 'browse' | 'point' | 'sector' | 'verbal';
type WaterGeometry = Exclude<GeoGeometry, { type: 'Point' }>;
export interface AtlasMapLayers {
  frame: WaterGeometry;
  water: WaterGeometry;
  alternate?: WaterGeometry;
  mask?: WaterGeometry;
  removed?: WaterGeometry;
  cut?: Position[][];
  grid?: Position[][];
  cells?: { id: string; corners: Position[] }[];
  waterParts?: { id: string; geometry: WaterGeometry }[];
  waterLinks?: Position[][];
  clipAreasToWater?: boolean;
  areas: { id: string; geometry: WaterGeometry; kind: 'reserve' | 'typha'; label: string }[];
  points: { id: string; coordinates: Position; label: string; outside?: boolean }[];
  villageNames?: boolean;
  density?: { id: string; corners: Position[]; kgM2: number; fill: string }[];
  legend: string;
}
export function GeoAtlasMap({features, selected, onSelect, mode='browse', vertices=[], onPlace, layers}: {features:GeoAtlasFeature[]; selected?:string; onSelect:(id:string)=>void; mode?:DrawMode; vertices?:Position[]; onPlace?:(p:Position)=>void; layers?:AtlasMapLayers}) {
  const [zoom,setZoom]=useState(1),[pan,setPan]=useState({x:0,y:0}),[cursor,setCursor]=useState({x:300,y:250});
  const clipId = useId();
  const drag=useRef<{x:number;y:number;pan:typeof pan; moved:boolean; feature?:string} | undefined>(undefined);
  const projection=useMemo(()=>{
    const outlines=features.filter(f=>f.properties.kind==='water-outline');
    const pts=layers?.frame ? geometryPoints(layers.frame) : (outlines.length?outlines:features).flatMap(f=>geometryPoints(f.geometry));
    if(!pts.length) return undefined;
    const xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]);
    const xmin=Math.min(...xs),xmax=Math.max(...xs),ymin=Math.min(...ys),ymax=Math.max(...ys);
    const lon=(xmin+xmax)/2,lat=(ymin+ymax)/2,aspect=Math.cos(lat*Math.PI/180),scale=430/Math.max((xmax-xmin)*aspect,ymax-ymin,.01);
    return { project:(p:Position)=>[300+(p[0]-lon)*aspect*scale,250-(p[1]-lat)*scale] as Position, inverse:(x:number,y:number)=>[lon+(x-300)/scale/aspect,lat-(y-250)/scale] as Position };
  },[features,layers?.frame]);
  if(!projection) return <div className="geo-empty"><h3>Fond géographique réel manquant</h3><p>Le contour du lac n’est pas encore disponible. Dites simplement le nom du lieu ou utilisez une carte papier ; aucun point n’est placé au hasard.</p></div>;
  const drawing=mode==='point'||mode==='sector';
  const line=(points:Position[])=>points.map((p,i)=>`${i?'L':'M'}${projection.project(p).join(',')}`).join(' ');
  const path=(g:GeoGeometry|null)=>!g||g.type==='Point'?'':(g.type==='Polygon'?[g.coordinates]:g.coordinates).map(poly=>poly.map(r=>line(r)+'Z').join(' ')).join(' ');
  const place=(x:number,y:number)=>onPlace?.(projection.inverse(x,y));
  const displayVertices=vertices.length>1&&String(vertices[0])===String(vertices.at(-1))?vertices.slice(0,-1):vertices;
  return <div className="geo-map">
    <div className="geo-map-controls" role="group" aria-label="Déplacement de la carte géographique">
      <button aria-label="Agrandir le fond géographique" disabled={zoom>=8} onClick={()=>setZoom(z=>Math.min(8,z*1.5))}>+</button><button aria-label="Réduire le fond géographique" disabled={zoom<=1} onClick={()=>setZoom(z=>Math.max(1,z/1.5))}>−</button><button onClick={()=>{setZoom(1);setPan({x:0,y:0});setCursor({x:300,y:250});}}>Recentrer le lac</button>
      <button aria-label="Déplacer vers le nord" onClick={()=>setPan(p=>({...p,y:p.y-60/zoom}))}>↑</button><button aria-label="Déplacer vers l’ouest" onClick={()=>setPan(p=>({...p,x:p.x-60/zoom}))}>←</button><button aria-label="Déplacer vers l’est" onClick={()=>setPan(p=>({...p,x:p.x+60/zoom}))}>→</button><button aria-label="Déplacer vers le sud" onClick={()=>setPan(p=>({...p,y:p.y+60/zoom}))}>↓</button>
    </div>
    <svg viewBox={`${300-300/zoom+pan.x} ${250-250/zoom+pan.y} ${600/zoom} ${500/zoom}`} role="group" tabIndex={0} aria-label={drawing?'Placer sur la carte : flèches pour déplacer le repère, Entrée pour poser':'Carte géographique des lieux'}
      onKeyDown={e=>{if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();const dx=e.key==='ArrowRight'?15:e.key==='ArrowLeft'?-15:0,dy=e.key==='ArrowDown'?15:e.key==='ArrowUp'?-15:0;if(drawing)setCursor(p=>({x:p.x+dx/zoom,y:p.y+dy/zoom}));else setPan(p=>({x:p.x+dx/zoom,y:p.y+dy/zoom}));}if(drawing&&e.key==='Enter'){e.preventDefault();place(cursor.x,cursor.y);}}}
      onPointerDown={e=>{if(e.button!==0)return; drag.current={x:e.clientX,y:e.clientY,pan,moved:false,feature:(e.target as Element).closest('[data-feature]')?.getAttribute('data-feature')??undefined};e.currentTarget.setPointerCapture(e.pointerId);}}
      onPointerMove={e=>{const d=drag.current;if(!d)return;if(Math.hypot(e.clientX-d.x,e.clientY-d.y)>6)d.moved=true;if(d.moved){const matrix=e.currentTarget.getScreenCTM();if(matrix)setPan({x:d.pan.x-(e.clientX-d.x)/matrix.a,y:d.pan.y-(e.clientY-d.y)/matrix.d});}}}
      onPointerUp={e=>{const d=drag.current;drag.current=undefined;if(d&&!d.moved){if(drawing){const matrix=e.currentTarget.getScreenCTM();if(matrix){const p=new DOMPoint(e.clientX,e.clientY).matrixTransform(matrix.inverse());place(p.x,p.y);}}else if(d.feature)onSelect(d.feature);}}}
      onPointerCancel={()=>{drag.current=undefined;}}>
      <title>{layers ? 'Contour aquatique et couches de terrain candidates' : 'Contour de référence et lieux déclarés ; aucune frontière réglementaire'}</title>
      {layers && <>
        <defs><clipPath id={clipId}><path d={path(layers.water)} clipRule="evenodd"/></clipPath></defs>
        {layers.removed && <path d={path(layers.removed)} fillRule="evenodd" className="geo-sig-removed"><title>Eau hors du périmètre étudié</title></path>}
        <path d={path(layers.water)} fillRule="evenodd" className="geo-water"/>
        <g clipPath={`url(#${clipId})`}>
          {layers.density?.map(cell=><path key={cell.id} d={line(cell.corners)+'Z'} fill={cell.fill}><title>{cell.id} · {cell.kgM2.toPrecision(4)} kg/m²</title></path>)}
          {layers.grid && <path className="geo-sig-grid" d={layers.grid.map(line).join(' ')}/>}
          {layers.waterParts?.length ? <path className="geo-sig-parts" fillRule="evenodd"
            d={layers.waterParts.map(part => path(part.geometry)).join(' ')}/> : null}
        </g>
        {layers.waterLinks?.length ? <path className="geo-sig-links" d={layers.waterLinks.map(line).join(' ')}/> : null}
        <g clipPath={layers.clipAreasToWater ? `url(#${clipId})` : undefined}>
          {layers.areas.map(area=><path key={area.id} d={path(area.geometry)} fillRule="evenodd" className={`geo-sig-${area.kind}`}><title>{area.label}</title></path>)}
        </g>
        {layers.alternate && <path d={path(layers.alternate)} className="geo-sig-alternate"><title>Contour de comparaison</title></path>}
        {layers.mask && <path d={path(layers.mask)} className="geo-sig-mask"><title>Limite du masque candidat</title></path>}
        {layers.cut && layers.cut.length > 0 && <path d={layers.cut.map(line).join(' ')} className="geo-sig-cut"><title>Interface aquatique coupée par le masque candidat</title></path>}
        <g clipPath={`url(#${clipId})`}>
          {layers.cells?.map(cell => <path key={cell.id} data-feature={cell.id} d={line(cell.corners)+'Z'}
            className={cell.id === selected ? 'geo-sig-cell geo-sig-cell-selected' : 'geo-sig-cell'}><title>{cell.id}</title></path>)}
        </g>
        {layers.points.map(point=>{
          const [cx,cy]=projection.project(point.coordinates);
          return <circle key={point.id} cx={cx} cy={cy} r={4/zoom} className={`geo-sig-village${point.outside ? ' geo-sig-village-outside' : ''}`}><title>{point.label}{point.outside && ' · hors de l’eau'}</title></circle>;
        })}
        {layers.villageNames && layers.points.map(point => {
          const [x,y] = projection.project(point.coordinates);
          return <text key={point.id} x={x + 5/zoom} y={y - 4/zoom} fontSize={9/zoom} className="geo-sig-village-name">{point.label}</text>;
        })}
      </>}
      {features.filter(f=>f.geometry&&f.geometry.type!=='Point').map(f=><path key={f.id} data-feature={f.properties.kind==='water-outline'?undefined:f.id} d={path(f.geometry)} fillRule="evenodd" className={f.properties.kind==='water-outline'?'geo-water':`geo-area${selected===f.id?' geo-selected':''}`} role={f.properties.kind==='water-outline'?undefined:'button'} tabIndex={f.properties.kind==='water-outline'?undefined:0} aria-label={`${f.properties.kind==='water-outline'?'Lac':'Secteur déclaré'} : ${f.properties.name}`} aria-pressed={f.properties.kind==='water-outline'?undefined:selected===f.id} onClick={()=>{if(!drawing&&f.properties.kind!=='water-outline')onSelect(f.id);}} onKeyDown={e=>{if(!drawing&&(e.key==='Enter'||e.key===' ')){e.preventDefault();e.stopPropagation();onSelect(f.id);}}}><title>{f.properties.name} · {f.properties.evidence==='reference-outline'?'Contour hydrologique, pas une limite de pêche':'Limites approximatives, non officielles'}</title></path>)}
      {features.filter(f=>f.geometry?.type==='Point').map(f=>{const p=projection.project((f.geometry as {coordinates:Position}).coordinates);return <g key={f.id} data-feature={f.id} role="button" tabIndex={0} aria-label={`Lieu déclaré : ${f.properties.name}`} aria-pressed={selected===f.id} className={`geo-point${selected===f.id?' geo-selected':''}`} onClick={()=>{if(!drawing)onSelect(f.id);}} onKeyDown={e=>{if(!drawing&&(e.key==='Enter'||e.key===' ')){e.preventDefault();e.stopPropagation();onSelect(f.id);}}}><circle cx={p[0]} cy={p[1]} r={22/zoom} className="geo-hit"/><circle cx={p[0]} cy={p[1]} r={9/zoom}/><title>Lieu déclaré, non vérifié : {f.properties.name}</title></g>;})}
      {vertices.length>1&&<path className="geo-draft" d={vertices.map((p,i)=>`${i?'L':'M'}${projection.project(p).join(',')}`).join(' ')}/>}
      {displayVertices.map((p,i)=>{const q=projection.project(p);return <g key={i}><circle className="geo-draft-vertex" cx={q[0]} cy={q[1]} r={6/zoom}/><text x={q[0]+9/zoom} y={q[1]-9/zoom} fontSize={15/zoom}>{i+1}</text></g>;})}
      {drawing&&<path className="geo-cursor" d={`M${cursor.x-12/zoom},${cursor.y}h${24/zoom}M${cursor.x},${cursor.y-12/zoom}v${24/zoom}`}/>}
      <text x={540/zoom+300-300/zoom+pan.x} y={90/zoom+250-250/zoom+pan.y} fontSize={16/zoom}>↑ N</text>
    </svg>
    <p className="geo-legend">{layers?.legend ?? '≈ Eau : contour de référence · ● Lieu indiqué · ▧ Secteur déclaré, non vérifié · ✓ Sélection (trait épais)'}</p>
    {drawing&&<p>Appuyez pour poser un {mode==='point'?'repère':'sommet'}. Glissez pour déplacer la carte. Au clavier : flèches, puis Entrée. Vous pouvez toujours préférer une description.</p>}
  </div>;
}
