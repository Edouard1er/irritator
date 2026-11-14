import type {Point} from './trajectory';
/** Cumulative observations only. No interpolation: absent monthly boundary => unavailable. */
export function monthlyCatches(points:Point[],end:number) {
  const at=(t:number)=>points.find(p=>Math.abs(p.time-t)<=32*Number.EPSILON*Math.max(1,Math.abs(t),Math.abs(p.time)));
  return Array.from({length:Math.floor(end)},(_,i)=>{
    const from=at(i),to=at(i+1);let valid=!!from&&!!to&&from.value>=0&&Number.isFinite(from.value)&&Number.isFinite(to.value)&&to.value>=from.value;
    let prior=from?.value??0;for(const p of points){if(!from||!to||p.time<from.time||p.time>to.time)continue;if(!Number.isFinite(p.value)||p.value<0||p.value<prior)valid=false;prior=p.value;}
    return {month:i+1,value:valid?to!.value-from!.value:undefined};
  });
}
