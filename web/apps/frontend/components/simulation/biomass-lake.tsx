'use client';
import { useEffect, useRef } from 'react';
import { fishCount } from '@/lib/simulation/indicators';
import type { BiomassStatus } from '@/lib/simulation/trajectory';
import {fleetEffort,seasonNames,type Conditions,type Fleet} from '@contracts';

export function BiomassLake({ value, unit, maximum, playing, reduced, state,environment,season,fleet,accessibility }: { value?: number; unit?: string; maximum: number; playing: boolean; reduced: boolean; state: BiomassStatus;environment?:Conditions;season?:number;fleet?:Fleet;accessibility?:number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const phase = useRef(0);
  const count = fishCount(value, unit);
  const displayedBiomass = value === undefined ? '—' : new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(value);
  const prior = useRef(count ?? 0);
  useEffect(() => {
    const element = canvas.current; if (!element || count === undefined) return;
    const ctx = element.getContext('2d'); if (!ctx) return;
    let frame = 0, last = 0, transition = 0;
    const start = prior.current; prior.current = count;
    const draw = (now: number) => {
      const rect = element.getBoundingClientRect(); const width = rect.width, height = rect.height;
      if (!width || !height) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (element.width !== Math.round(width*dpr) || element.height !== Math.round(height*dpr)) { element.width = Math.round(width*dpr); element.height = Math.round(height*dpr); }
      ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,width,height);
      const elapsed = last ? Math.min(now-last, 50) : 0; last = now;
      if (playing && !reduced) { phase.current += elapsed/1000; transition = Math.min(1, transition + elapsed/450); } else transition = 1;
      const displayed = start + (count-start)*transition;
      prior.current = displayed;
      const sky=environment?Math.max(100,height*.27):0;
      if(environment){
        ctx.fillStyle=['#e4f3cf','#ffedb0','#e4dacb','#cedce7'][season??0]!;ctx.fillRect(0,0,width,sky);
        const salt=environment.S/10;ctx.fillStyle=`rgb(${Math.round(71+salt*84)},${Math.round(177-salt*20)},${Math.round(194-salt*48)})`;ctx.fillRect(0,sky,width,height-sky);
        const weatherSize=Math.max(40,Math.min(64,width*.14)),wx=width-weatherSize*.85-12,wy=weatherSize*.75+10,r=weatherSize*.33;
        if(season===0||season===1){
          ctx.strokeStyle=season===1?'#e6a12c':'#d6b85d';ctx.lineWidth=season===1?3:2;
          for(let i=0;i<12;i++){const angle=i*Math.PI/6+Math.sin(phase.current*.2)*.04;ctx.beginPath();ctx.moveTo(wx+Math.cos(angle)*r*1.35,wy+Math.sin(angle)*r*1.35);ctx.lineTo(wx+Math.cos(angle)*r*1.8,wy+Math.sin(angle)*r*1.8);ctx.stroke();}
          ctx.fillStyle=season===1?'#f5bd38':'#f2d47c';ctx.beginPath();ctx.arc(wx,wy,r,0,Math.PI*2);ctx.fill();
        } else {
          ctx.fillStyle=season===2?'#a8b4bb':'#879fac';
          for(const [dx,dy,rr] of [[-.28,.05,.23],[0,-.1,.31],[.3,.04,.24]] as const){ctx.beginPath();ctx.arc(wx+dx*weatherSize,wy+dy*weatherSize,rr*weatherSize,0,Math.PI*2);ctx.fill();}
          if(season===3){ctx.strokeStyle='#597989';ctx.lineWidth=2;for(let i=0;i<3;i++){const drift=Math.sin(phase.current*.8+i)*5;ctx.beginPath();ctx.moveTo(wx-weatherSize*.45+drift,wy+weatherSize*(.4+i*.12));ctx.lineTo(wx+weatherSize*(.2+i*.08)+drift,wy+weatherSize*(.4+i*.12));ctx.stroke();}}
        }
        // Reeds, leaves and wind follow simulated seasons; no real-world clock or snow.
        if(season===0){ctx.strokeStyle='#79a264';ctx.lineWidth=2;for(let i=0;i<9;i++){const x=8+i*8;ctx.beginPath();ctx.moveTo(x,sky);ctx.lineTo(x+Math.sin(phase.current+i)*3,sky-12-i%3*5);ctx.stroke();}}
        // Seasonal particles and rain are illustrative and never alter scientific samples.
        if(season===2)for(let i=0;i<10;i++){const x=(i*79+phase.current*8)%width,y=(i*19+phase.current*8)%Math.max(1,sky);ctx.fillStyle='#b4773c';ctx.fillRect(x,y,6,3);}
        ctx.strokeStyle='#246c99aa';ctx.lineWidth=1;ctx.beginPath();for(let i=0;i<Math.round(environment.P*18);i++){const x=(i*83.7)%width,y=(i*37.3+phase.current*145)%height;ctx.moveTo(x,y);ctx.lineTo(x-3,y+8);}ctx.stroke();
      }
      const capacity = Math.max(Math.ceil(maximum/10), count, 1), columns = Math.max(1, Math.ceil(Math.sqrt(capacity * width/(height-sky))));
      const rows = Math.ceil(capacity/columns), cw = width/columns, ch = (height-sky)/rows, size = Math.min(cw*.85, ch*.8, 34);
      // A coprime stride spreads a growing prefix through stable, distinct cells.
      const gcd=(a:number,b:number):number=>b?gcd(b,a%b):a;
      let stride=Math.max(1,Math.floor(capacity*.618));while(gcd(stride,capacity)!==1)stride++;
      const visible = Math.ceil(displayed);
      for (let i=0; i<visible; i++) {
        const cell=i*stride%capacity;
        const x = (cell%columns+.5)*cw + Math.sin(phase.current*.6+i*2.4)*cw*.08;
        const y = sky+(Math.floor(cell/columns)+.5)*ch + Math.cos(phase.current*.5+i*1.7)*ch*.08;
        ctx.save(); ctx.translate(x,y); if(i%3===0)ctx.scale(-1,1);
        ctx.globalAlpha = Math.min(1,displayed-i)*.9; ctx.fillStyle = '#075b72';
        ctx.beginPath(); ctx.ellipse(0,0,size*.38,size*.21,0,0,Math.PI*2); ctx.fill();
        ctx.beginPath();ctx.moveTo(-size*.3,0);ctx.lineTo(-size*.62,-size*.24);ctx.lineTo(-size*.62,size*.24);ctx.closePath();ctx.fill();
        ctx.fillStyle='#d7f7ef';ctx.beginPath();ctx.arc(size*.2,-size*.035,Math.max(.65,size*.035),0,Math.PI*2);ctx.fill();ctx.restore();
      }
      if(fleet){const total=fleet.counts.reduce((a,b)=>a+b,0),cols=Math.max(1,Math.ceil(Math.sqrt(Math.max(1,total)*width/Math.max(12,sky))));let n=0;fleet.counts.forEach((boats,category)=>{for(let i=0;i<boats;i++,n++){const x=(n%cols+.5)*width/cols,y=sky-3+Math.floor(n/cols)*Math.max(3,sky*.35/Math.max(1,Math.ceil(total/cols))),size=Math.min([30,23,17][category]!,width/cols*.9);ctx.fillStyle=['#70482d','#94633d','#bb8755'][category]!;ctx.beginPath();ctx.moveTo(x-size/2,y);ctx.lineTo(x+size/2,y);ctx.lineTo(x+size*.3,y+size*.2);ctx.lineTo(x-size*.3,y+size*.2);ctx.closePath();ctx.fill();ctx.strokeStyle='#fff4de';ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+size*.3,y-size*.3);ctx.stroke();}});}
      if (playing && !reduced) frame=requestAnimationFrame(draw);
    };
    const resize = new ResizeObserver(() => { if (!playing || reduced) draw(0); }); resize.observe(element);
    draw(0); return () => { cancelAnimationFrame(frame); resize.disconnect(); };
  }, [count, maximum, playing, reduced,environment,season,fleet]);
  return <div className={`lake-illustration status-${state}`}>
    {count === undefined ? <p className="lake-unavailable">Échelle en tonnes non disponible pour cette série.</p> : <canvas ref={canvas} data-biomass={value} data-fish-count={count} data-season={season===undefined?undefined:seasonNames[season]} data-rain={environment?.P} data-salinity={environment?.S} data-boats={fleet?.counts.join(',')} data-effort={fleet?fleetEffort(fleet):undefined} role="img" aria-label={`Biomasse : ${displayedBiomass} tonnes ; ${count} poissons affichés ; ${playing && !reduced ? 'animation active' : 'image fixe'}${environment?` ; ${seasonNames[season??0]}, pluie ${environment.P}/10, salinité ${environment.S}/10, pirogues ${fleet?.counts.join('/')}`:''}`} />}
    {environment&&season!==undefined&&<span className="lake-season">{seasonNames[season]}</span>}
    <div className="lake-readings"><span className="lake-count">Biomasse : {displayedBiomass} {unit==='t'?'tonnes':unit}</span>{accessibility!==undefined&&accessibility>=0&&accessibility<=1&&<span>Accessibilité : {new Intl.NumberFormat('fr-FR',{maximumFractionDigits:1}).format(accessibility*100)} %</span>}</div>
  </div>;
}
