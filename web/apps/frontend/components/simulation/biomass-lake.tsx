'use client';
import { useEffect, useRef } from 'react';
import { fishCount } from '@/lib/simulation/indicators';
import type { BiomassStatus } from '@/lib/simulation/trajectory';

export function BiomassLake({ value, unit, maximum, playing, reduced, state }: { value?: number; unit?: string; maximum: number; playing: boolean; reduced: boolean; state: BiomassStatus }) {
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
      const capacity = Math.max(maximum, count, 1), columns = Math.max(1, Math.ceil(Math.sqrt(capacity * width/height)));
      const rows = Math.ceil(capacity/columns), cw = width/columns, ch = height/rows, size = Math.min(cw*.85, ch*.8, 23);
      // A coprime stride spreads a growing prefix through stable, distinct cells.
      const gcd=(a:number,b:number):number=>b?gcd(b,a%b):a;
      let stride=Math.max(1,Math.floor(capacity*.618));while(gcd(stride,capacity)!==1)stride++;
      const visible = Math.ceil(displayed);
      for (let i=0; i<visible; i++) {
        const cell=i*stride%capacity;
        const x = (cell%columns+.5)*cw + Math.sin(phase.current*.6+i*2.4)*cw*.08;
        const y = (Math.floor(cell/columns)+.5)*ch + Math.cos(phase.current*.5+i*1.7)*ch*.08;
        ctx.save(); ctx.translate(x,y); if(i%3===0)ctx.scale(-1,1);
        ctx.globalAlpha = Math.min(1,displayed-i)*.9; ctx.fillStyle = '#075b72';
        ctx.beginPath(); ctx.ellipse(0,0,size*.38,size*.21,0,0,Math.PI*2); ctx.fill();
        ctx.beginPath();ctx.moveTo(-size*.3,0);ctx.lineTo(-size*.62,-size*.24);ctx.lineTo(-size*.62,size*.24);ctx.closePath();ctx.fill();
        ctx.fillStyle='#d7f7ef';ctx.beginPath();ctx.arc(size*.2,-size*.035,Math.max(.65,size*.035),0,Math.PI*2);ctx.fill();ctx.restore();
      }
      if (playing && !reduced) frame=requestAnimationFrame(draw);
    };
    const resize = new ResizeObserver(() => { if (!playing || reduced) draw(0); }); resize.observe(element);
    draw(0); return () => { cancelAnimationFrame(frame); resize.disconnect(); };
  }, [count, maximum, playing, reduced]);
  return <div className={`lake-illustration status-${state}`}>
    {count === undefined ? <p className="lake-unavailable">Échelle en tonnes non disponible pour cette série.</p> : <canvas ref={canvas} data-fish-count={count} role="img" aria-label={`${count} symboles de poisson, biomasse arrondie à la tonne ; ${playing && !reduced ? 'animation active' : 'image fixe'}`} />}
    <span className="lake-count">{count === undefined ? '—' : new Intl.NumberFormat('fr-FR').format(count)} symboles</span>
  </div>;
}
