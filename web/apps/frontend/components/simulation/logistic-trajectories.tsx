'use client';
import { useEffect, useRef, useState } from 'react';
import type * as Plotly from 'plotly.js';
import { loadPlotly } from '@/components/charts/trajectory-plot';
import { spatialChartSamples, spatialReading, type SpatialCell, type SpatialTrajectory } from '@/lib/simulation/spatial-experiment';
import styles from './logistic-spatial.module.css';

const colors = ['#4e657b', '#9d4a16', '#14645e', '#83632d', '#7744a2', '#236aad', '#aa3f66', '#507320', '#9d493d'];

export function logisticSeriesColor(cell: SpatialCell): string {
  return colors[cell.row * 3 + cell.column] ?? colors[0]!;
}

export function LogisticTrajectories({ series, time, start, end }: {
  series: SpatialTrajectory[];
  time: number;
  start: number;
  end: number;
}) {
  const target = useRef<HTMLDivElement>(null);
  const instance = useRef<typeof Plotly>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const element = target.current;
    return () => {
      if (element) instance.current?.purge(element);
      instance.current = null;
    };
  }, []);

  useEffect(() => {
    const element = target.current;
    if (!element) return;
    let disposed = false;
    void loadPlotly().then(async plot => {
      if (disposed) return;
      instance.current = plot;
      const traces: Plotly.Data[] = series.flatMap(trajectory => {
        const { cell, constant } = trajectory;
        const points = spatialChartSamples(trajectory, end);
        const current = spatialReading(trajectory, time);
        const color = logisticSeriesColor(cell);
        const curve: Plotly.Data = {
          type: 'scatter',
          mode: 'lines',
          name: cell.id,
          x: points.map(p => p.time),
          y: points.map(p => p.value),
          line: { color, dash: constant ? 'dash' : 'solid', width: 2.5, shape: 'linear' },
          hovertemplate: constant
            ? 'Équilibre maintenu · %{y} t<extra>%{fullData.name}</extra>'
            : '%{y} t à %{x} mois<extra>%{fullData.name}</extra>',
        };
        const marker: Plotly.Data = {
          type: 'scatter',
          mode: 'markers',
          name: cell.id,
          x: current ? [time] : [],
          y: current ? [current.value] : [],
          marker: { color, size: 9, line: { color: '#ffffff', width: 2 } },
          hoverinfo: 'skip',
        };
        return [curve, marker];
      });

      await plot.react(element, traces, {
        autosize: true,
        paper_bgcolor: '#ffffff',
        plot_bgcolor: '#ffffff',
        margin: { l: 57, r: 20, t: 14, b: 48 },
        font: { family: 'Segoe UI, sans-serif', size: 11, color: '#456369' },
        xaxis: { title: { text: 'Temps simulé (mois)' }, range: [start, end], gridcolor: '#edf3f1', fixedrange: true },
        yaxis: { title: { text: 'Biomasse (t)' }, rangemode: 'tozero', gridcolor: '#edf3f1', fixedrange: true },
        shapes: [{ type: 'line', x0: time, x1: time, yref: 'paper', y0: 0, y1: 1, line: { color: '#436669', dash: 'dot', width: 1.5 } }],
        showlegend: false,
        hovermode: 'closest',
      }, { responsive: true, displayModeBar: false, displaylogo: false });
      if (!disposed) setError('');
    }).catch(cause => {
      if (!disposed) setError(cause instanceof Error ? cause.message : 'Graphique indisponible.');
    });
    return () => { disposed = true; };
  }, [series, time, start, end]);

  return <div className={styles.chart} role="img" aria-label="Trajectoires logistiques"
    data-time={time} data-series={series.map(item => item.cell.id).join(',')}>
    <div className={styles.plot} ref={target} hidden={!!error} />
    {error && <p role="alert" className={styles.chartMessage}>{error}</p>}
  </div>;
}
