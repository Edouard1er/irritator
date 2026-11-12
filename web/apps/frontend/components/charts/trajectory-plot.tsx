'use client';
import { useEffect, useRef, useState } from 'react';
import type { RunResult } from '@contracts';
import type * as Plotly from 'plotly.js';

let plotlyPromise: Promise<typeof Plotly> | undefined;
function loadPlotly(): Promise<typeof Plotly> {
  if (plotlyPromise) return plotlyPromise;
  plotlyPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/vendor/plotly-basic.min.js';
    script.onload = () => resolve((window as unknown as { Plotly: typeof Plotly }).Plotly);
    script.onerror = () => { plotlyPromise = undefined; script.remove(); reject(new Error('La ressource locale Plotly est indisponible.')); };
    document.head.append(script);
  });
  return plotlyPromise;
}

export default function TrajectoryPlot({ observations, childClock = false }: { observations: (RunResult['observations'][number] & { label?: string; hoverLabel?: string })[]; childClock?: boolean }) {
  const element = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string>();
  useEffect(() => {
    let disposed = false;
    let plot: typeof Plotly | undefined;
    let resize: ResizeObserver | undefined;
    const target = element.current;
    if (!target) return;
    loadPlotly().then(async module => {
      if (disposed) return;
      plot = module;
      await plot.react(target, observations.map(o => ({
        type: 'scatter' as const, mode: 'lines+markers' as const, name: o.label ?? o.component,
        x: o.samples.map(s => s.time), y: o.samples.map(s => s.value),
        line: { width: 2, shape: 'linear' as const }, marker: { size: 5 },
        hovertemplate: `${o.hoverLabel ?? o.component}<br>t = %{x}<br>valeur = %{y}<extra></extra>`,
      })), {
        autosize: true, margin: { l: 58, r: childClock ? 310 : 24, t: 16, b: 45 },
        paper_bgcolor: 'white', plot_bgcolor: 'white', font: { family: 'Segoe UI, sans-serif', size: 11, color: '#576777' },
        xaxis: { title: { text: childClock ? 'Temps local enfant' : 'Temps simulé' }, gridcolor: '#eff2f5', zerolinecolor: '#e1e7ed' },
        yaxis: { title: { text: 'Valeur observée' }, gridcolor: '#eff2f5', zerolinecolor: '#e1e7ed' },
        colorway: childClock ? ['#107b77', '#6b66b6', '#cf8640', '#3d7db6', '#b55872', '#55752f', '#e3633c', '#9d4695', '#4c91b5', '#997044', '#588f74', '#b56728'] : ['#107b77', '#6b66b6', '#cf8640', '#3d7db6', '#b55872'],
        legend: childClock ? { orientation: 'v', x: 1.02, y: 1, font: { size: 9 } } : { orientation: 'h', x: 1, xanchor: 'right', y: 1.13 }, showlegend: observations.length > 1,
        hovermode: 'closest', uirevision: 'trajectory',
      }, { responsive: true, displaylogo: false, scrollZoom: true, toImageButtonOptions: { filename: 'irritator-trajectoires', format: 'png', scale: 2 }, modeBarButtonsToRemove: ['lasso2d', 'select2d'] });
      if (disposed) { plot.purge(target); return; }
      resize = new ResizeObserver(() => { if (!disposed) void plot?.Plots.resize(target); });
      resize.observe(target);
    }).catch(e => { if (!disposed) setError(e instanceof Error ? e.message : 'Chargement du graphique impossible.'); });
    return () => { disposed = true; resize?.disconnect(); plot?.purge(target); };
  }, [observations, childClock]);
  return error ? <p role="alert">Graphique : {error}. Les points restent disponibles dans le tableau.</p> : <div ref={element} className="trajectory-plot" role="img" aria-label="Trajectoires calculées par Irritator" />;
}
