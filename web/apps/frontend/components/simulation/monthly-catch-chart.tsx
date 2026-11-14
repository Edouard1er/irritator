'use client';
import {useEffect,useRef,useState} from 'react';
import {monthlyCatches} from '@/lib/simulation/monthly';
import type {Series} from '@/lib/simulation/trajectory';
import {calendarTime} from '@contracts';
const fmt=(n:number)=>new Intl.NumberFormat('fr-FR',{maximumFractionDigits:6}).format(n);
export function MonthlyCatchChart({series,time,end,baseline,onSelect}:{series:Series;time:number;end:number;baseline?:Series;onSelect?:(time:number)=>void}) {
  time=calendarTime(time);
  const container=useRef<HTMLDivElement>(null),[width,setWidth]=useState(760),[hover,setHover]=useState<number>();
  useEffect(()=>{const el=container.current;if(!el)return;const resize=new ResizeObserver(()=>setWidth(Math.max(280,el.clientWidth)));resize.observe(el);return()=>resize.disconnect();},[]);
  const months=monthlyCatches(series.points,end),initial=baseline?monthlyCatches(baseline.points,end):[],max=Math.max(1,...months.map(m=>m.value??0),...initial.map(m=>m.value??0))*1.08;
  const height=170,left=60,right=16,top=16,bottom=126,plotWidth=width-left-right;
  const x=(month:number)=>left+month/Math.max(1,end)*plotWidth,y=(value:number)=>bottom-value/max*(bottom-top);
  const line=(values:typeof months,until:number)=>{let gap=true;return values.map(m=>{if(m.month>until||m.value===undefined){gap=true;return '';}const command=gap?'M':'L';gap=false;return command+x(m.month)+','+y(m.value);}).join(' ');};
  const current=months.findLast(m=>m.month<=time&&m.value!==undefined)?.month,selected=months.find(m=>m.month===hover&&m.month<=time),tick=Math.max(1,Math.ceil(end/(width<450?6:12)));
  return <div ref={container} className="monthly-catch-chart">
    <svg viewBox={`0 0 ${width} ${height}`} role="group" aria-label="Captures mensuelles en courbe, valeurs discrètes en tonnes">
      {[0,.5,1].map(r=><g key={r}><line x1={left} x2={width-right} y1={y(r*max)} y2={y(r*max)} stroke="#e3ebee"/><text x={left-6} y={y(r*max)+4} textAnchor="end" fontSize="11">{(r*max).toFixed(1)}</text></g>)}
      <text transform={`translate(13 ${(top+bottom)/2}) rotate(-90)`} textAnchor="middle" fontSize="11">Quantité pêchée (tonnes)</text>
      {Array.from({length:Math.floor(end/tick)+1},(_,i)=>i*tick).map(month=><text key={month} x={x(month)} y={bottom+18} textAnchor="middle" fontSize="11">{month}</text>)}
      <text x={left+plotWidth/2} y={height-4} textAnchor="middle" fontSize="12">Temps (mois)</text>
      {baseline&&<path data-monthly-baseline d={line(initial,Infinity)} fill="none" stroke="#657eaa" strokeWidth="2" strokeDasharray="5 4"/>}
      <path data-monthly-line d={line(months,time)} fill="none" stroke="#117d78" strokeWidth="3" strokeLinejoin="round"/>
      <line data-monthly-cursor x1={x(Math.max(0,Math.min(end,time)))} x2={x(Math.max(0,Math.min(end,time)))} y1={top} y2={bottom} stroke="#324a5c" strokeWidth="1.5" strokeDasharray="3 3"/>
      {months.map(m=><g key={m.month} data-month={m.month} data-catch={m.value} data-complete={m.month<=time}>
        {m.month<=time&&(m.value!==undefined?<circle data-monthly-point data-current={m.month===current} cx={x(m.month)} cy={y(m.value)} r={m.month===current?6:4} fill={m.month===current?'#fff':'#117d78'} stroke="#117d78" strokeWidth={m.month===current?3:1} tabIndex={0} role={onSelect?'button':'img'} aria-label={`Mois ${m.month} : ${fmt(m.value)} tonnes`} onMouseEnter={()=>setHover(m.month)} onMouseLeave={()=>setHover(undefined)} onFocus={()=>setHover(m.month)} onBlur={()=>setHover(undefined)} onClick={()=>onSelect?.(m.month)} onKeyDown={e=>{if(onSelect&&(e.key==='Enter'||e.key===' ')){e.preventDefault();onSelect(m.month);}}}><title>Mois {m.month} : {fmt(m.value)} tonnes</title></circle>:<text x={x(m.month)} y={bottom-4} textAnchor="middle" aria-label={`Mois ${m.month} indisponible`}>?</text>)}
      </g>)}
    </svg>
    {selected?.value!==undefined&&<div role="tooltip" className="monthly-tooltip">Mois {selected.month} · {fmt(selected.value)} tonnes</div>}
  </div>;
}
