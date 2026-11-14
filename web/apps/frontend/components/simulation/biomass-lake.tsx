'use client';
import { useEffect, useRef } from 'react';
import { fishCount } from '@/lib/simulation/indicators';
import type { BiomassStatus } from '@/lib/simulation/trajectory';
import {fleetEffort,seasonNames,type Conditions,type Fleet} from '@contracts';

export function BiomassLake({ value, unit, maximum, playing, reduced, state,environment,season,fleet }: { value?: number; unit?: string; maximum: number; playing: boolean; reduced: boolean; state: BiomassStatus;environment?:Conditions;season?:number;fleet?:Fleet }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const phase = useRef(0);
  const count = fishCount(value, unit);
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
      const sky=environment?Math.max(36,height*.23):0;
      if(environment){
        ctx.fillStyle=['#dcefd5','#fff0c3','#e6d7c3','#dce6ee'][season??0]!;ctx.fillRect(0,0,width,sky);
        const salt=environment.S/10;ctx.fillStyle=`rgb(${Math.round(71+salt*84)},${Math.round(177-salt*20)},${Math.round(194-salt*48)})`;ctx.fillRect(0,sky,width,height-sky);
        ctx.fillStyle='#f5c85a';ctx.beginPath();ctx.arc(width*.88,sky*.34,season===3?7:11,0,Math.PI*2);ctx.fill();
        // Seasonal particles and rain are illustrative and never alter scientific samples.
        if(season===0||season===2||season===3)for(let i=0;i<12;i++){const x=(i*79+phase.current*8)%width,y=(i*19+phase.current*(season===3?15:8))%Math.max(1,sky);ctx.fillStyle=season===0?'#ed9ec0':season===2?'#b4773c':'#ffffff';ctx.fillRect(x,y,season===2?5:3,3);}
        ctx.strokeStyle='#246c99aa';ctx.lineWidth=1;ctx.beginPath();for(let i=0;i<Math.round(environment.P*18);i++){const x=(i*83.7)%width,y=(i*37.3+phase.current*145)%height;ctx.moveTo(x,y);ctx.lineTo(x-3,y+8);}ctx.stroke();
      }
      const capacity = Math.max(maximum, count, 1), columns = Math.max(1, Math.ceil(Math.sqrt(capacity * width/(height-sky))));
      const rows = Math.ceil(capacity/columns), cw = width/columns, ch = (height-sky)/rows, size = Math.min(cw*.85, ch*.8, 23);
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
      if(fleet){const total=fleet.counts.reduce((a,b)=>a+b,0),cols=Math.max(1,Math.ceil(Math.sqrt(Math.max(1,total)*width/Math.max(12,sky))));let n=0;fleet.counts.forEach((boats,category)=>{for(let i=0;i<boats;i++,n++){const x=(n%cols+.5)*width/cols,y=sky*.6+Math.floor(n/cols)*Math.max(3,sky*.35/Math.max(1,Math.ceil(total/cols))),size=Math.min([30,23,17][category]!,width/cols*.9);ctx.fillStyle=['#70482d','#94633d','#bb8755'][category]!;ctx.beginPath();ctx.moveTo(x-size/2,y);ctx.lineTo(x+size/2,y);ctx.lineTo(x+size*.3,y+size*.2);ctx.lineTo(x-size*.3,y+size*.2);ctx.closePath();ctx.fill();ctx.strokeStyle='#fff4de';ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+size*.3,y-size*.3);ctx.stroke();}});}
      if (playing && !reduced) frame=requestAnimationFrame(draw);
    };
    const resize = new ResizeObserver(() => { if (!playing || reduced) draw(0); }); resize.observe(element);
    draw(0); return () => { cancelAnimationFrame(frame); resize.disconnect(); };
  }, [count, maximum, playing, reduced,environment,season,fleet]);
  return <div className={`lake-illustration status-${state}`}>
    {count === undefined ? <p className="lake-unavailable">Échelle en tonnes non disponible pour cette série.</p> : <canvas ref={canvas} data-fish-count={count} data-season={season===undefined?undefined:seasonNames[season]} data-rain={environment?.P} data-salinity={environment?.S} data-boats={fleet?.counts.join(',')} data-effort={fleet?fleetEffort(fleet):undefined} role="img" aria-label={`${count} symboles de poisson, biomasse arrondie à la tonne ; ${playing && !reduced ? 'animation active' : 'image fixe'}${environment?` ; ${seasonNames[season??0]}, pluie ${environment.P}/10, salinité ${environment.S}/10, pirogues ${fleet?.counts.join('/')}`:''}`} />}
    <span className="lake-count">{count === undefined ? '—' : new Intl.NumberFormat('fr-FR').format(count)} symboles</span>
  </div>;
}
