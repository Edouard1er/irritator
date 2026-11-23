'use client';
import { useEffect, useRef, useState } from 'react';
import type * as Plotly from 'plotly.js';
import { loadPlotly } from '@/components/charts/trajectory-plot';
import { statusInfo, type AlertConfig, type BiomassStatus, type Series } from '@/lib/simulation/trajectory';

export default function WorkshopChart({ series, timeUnit, index, time, statuses, config, biomass = false, baseline, interventions=[] }: {
  series: Series; timeUnit: string; index: number; time?: number; statuses: BiomassStatus[]; config: AlertConfig; biomass?: boolean; baseline?:Series; interventions?:number[];
}) {
  const target = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let disposed = false; let resize: ResizeObserver | undefined; let module: typeof Plotly | undefined;
    const element = target.current;
    if (!element) return;
    void loadPlotly().then(async plot => {
      if (disposed) return;
      module = plot;
      const finiteValue = (n: number) => Number.isFinite(n) ? n : null;
      // Only pass elapsed observations to Plotly, including comparison/hover data.
      const visibleTime = time ?? series.points[index]?.time ?? -Infinity;
      const visible = series.points.filter(p => biomass ? p.time <= visibleTime : time !== undefined && p.time <= time);
      const baselineVisible = baseline?.points.filter(p => !biomass || p.time <= visibleTime);
      const traces: Plotly.Data[] = [];
      if(baselineVisible)traces.push({type:'scatter',mode:biomass&&baselineVisible.length===1?'lines+markers':'lines',name:'Trajectoire initiale',x:baselineVisible.map(p=>p.time),y:baselineVisible.map(p=>finiteValue(p.value)),line:{color:'#657eaa',dash:'dash',width:2},marker:{size:4},hovertemplate:'Initiale : %{y} t à %{x} mois<extra></extra>'});
      if (biomass) {
        for (const status of Object.keys(statusInfo) as BiomassStatus[]) {
          const x: (number | null)[] = [], y: (number | null)[] = [];
          visible.forEach((p, i) => { if (statuses[i] === status) { if (i > 0) { x.push(visible[i - 1]!.time); y.push(finiteValue(visible[i - 1]!.value)); } x.push(p.time, null); y.push(finiteValue(p.value), null); } });
          traces.push({ type: 'scatter', mode: 'lines+markers', name: statusInfo[status].title, x, y, line: { color: statusInfo[status].color, width: 3, shape: 'hv' }, marker: { size: 4 }, connectgaps: false, showlegend: false, hovertemplate: `t = %{x} (${timeUnit})<br>B = %{y} (${series.unit})<extra>${statusInfo[status].title}</extra>` });
        }
      } else traces.push({ type: 'scatter', mode: 'lines+markers', name: series.id, x: visible.map(p => p.time), y: visible.map(p => finiteValue(p.value)), line: { color: '#117d78', width: 3, shape: 'hv' }, marker: { size: 3 }, connectgaps: false, hovertemplate: `t = %{x} (${timeUnit})<br>%{y} (${series.unit})<extra>${series.id}</extra>` });
      const shapes: Partial<Plotly.Shape>[] = [];
      const annotations: Partial<Plotly.Annotations>[] = [];
      for(const at of [...new Set(interventions)]){shapes.push({type:'line',x0:at,x1:at,yref:'paper',y0:0,y1:1,line:{color:'#8c4089',dash:'dash',width:2}});annotations.push({x:at,y:1,xref:'x',yref:'paper',text:`Intervention ${Number(at.toFixed(4))}`,showarrow:false,yanchor:'bottom',font:{color:'#8c4089',size:10}});}
      if (biomass && config.bCrit !== undefined && config.bCrit > 0 && Number.isFinite(config.bCrit)) {
        const upper = config.bCrit * (1 + config.proximityRatio);
        shapes.push({ type: 'rect', xref: 'paper', x0: 0, x1: 1, y0: config.bCrit, y1: upper, fillcolor: '#fff0d9', opacity: 0.7, line: { width: 0 }, layer: 'below' }, { type: 'line', xref: 'paper', x0: 0, x1: 1, y0: config.bCrit, y1: config.bCrit, line: { color: '#b52b3b', dash: 'dash', width: 2 } });
        annotations.push({ xref: 'paper', x: 1, y: config.bCrit, text: `Seuil d’atelier : ${config.bCrit}`, xanchor: 'right', yanchor: 'top', showarrow: false, bgcolor: '#fff', font: { color: '#9d2736', size: 12 } }, { xref: 'paper', x: 1, y: upper, text: `Zone d’alerte ≤ ${Number(upper.toPrecision(6))}`, xanchor: 'right', yanchor: 'bottom', showarrow: false, font: { color: '#984908', size: 12 } });
      }
      if (time !== undefined) shapes.push({ type: 'line', x0: time, x1: time, yref: 'paper', y0: 0, y1: 1, line: { color: '#324a5c', dash: 'dot', width: 2 } });
      await plot.react(element, traces, {
        autosize: true, margin: { l: 65, r: 18, t: 18, b: 42 }, paper_bgcolor: '#fff', plot_bgcolor: '#fff',
        font: { family: 'Segoe UI, sans-serif', size: 12, color: '#496171' },
        xaxis: { title: { text: `Temps simulé (${timeUnit})` }, range: [series.points[0]?.time ?? 0, series.points.at(-1)?.time ?? 1], gridcolor: '#edf1f4' },
        yaxis: { title: { text: `${biomass ? 'Biomasse' : series.kind === 'catch_rate' ? 'Débit de capture' : 'Capture'} (${series.unit}${series.kind === 'catch_rate' && !series.unit.includes('/') ? ` / ${timeUnit}` : ''})` }, gridcolor: '#edf1f4', rangemode: 'tozero' },
        shapes, annotations, showlegend: false, hovermode: 'closest', uirevision: series.id,
      }, { responsive: true, displaylogo: false, modeBarButtonsToRemove: ['lasso2d', 'select2d'], toImageButtonOptions: { filename: 'irritator-atelier', format: 'png', scale: 2 } });
      if (disposed) { plot.purge(element); return; }
      resize = new ResizeObserver(() => {
        // Levels and modeling steps keep charts mounted while their parents are hidden.
        if (!disposed && element.getClientRects().length && element.clientWidth > 0) {
          void Promise.resolve(plot.Plots.resize(element)).catch(() => { if (!disposed && element.getClientRects().length) setError(true); });
        }
      }); resize.observe(element);
    }).catch(() => { if (!disposed) setError(true); });
    return () => { disposed = true; resize?.disconnect(); module?.purge(element); };
  }, [series, index, time, timeUnit, statuses, config, biomass, baseline, interventions]);
  return error ? <p role="alert">Graphique indisponible. Consultez les observations dans la lecture scientifique.</p> : <div ref={target} className="workshop-plot" role="img" aria-label={`${biomass ? 'Biomasse totale' : 'Capture'} ; utilisez le curseur temporel au clavier pour consulter les observations exactes.`} />;
}
