'use client';
import { useEffect, useRef, useState } from 'react';
import type * as Plotly from 'plotly.js';
import { loadPlotly } from '@/components/charts/trajectory-plot';
import { spatialChartSamples, spatialReading, type SpatialCell, type SpatialTotal, type SpatialTrajectory } from '@/lib/simulation/spatial-experiment';
import styles from './logistic-spatial.module.css';

const colors = [
  ['#4e657b', '#9d4a16', '#14645e', '#8a356d'],
  ['#83632d', '#7744a2', '#236aad', '#005c8e'],
  ['#aa3f66', '#507320', '#9d493d', '#675122'],
  ['#006748', '#813c2f', '#51468e', '#343e47'],
  ['#334787', '#9d3560', '#3a6e73', '#514c27'],
  ['#985025', '#585985', '#456c2f', '#7b4858'],
] as const;

export function logisticSeriesColor(cell: SpatialCell): string {
  return colors[cell.row % colors.length]![cell.column % colors[0].length]!;
}

type PlotPosition = {
  time: number;
  start: number;
  end: number;
};

type PlotSeries = {
  name: string;
  points: readonly SpatialTotal[];
  current?: number | null;
  color: string;
  dash: 'solid' | 'dash' | 'dot';
  constant?: boolean;
};

export function LogisticTrajectories({ series, time, start, end }: PlotPosition & { series: SpatialTrajectory[] }) {
  return <LogisticTrajectoryPlot label="Trajectoires logistiques" time={time} start={start} end={end}
    series={series.map(trajectory => ({
      name: trajectory.cell.id,
      points: spatialChartSamples(trajectory, end),
      current: spatialReading(trajectory, time)?.value,
      color: logisticSeriesColor(trajectory.cell),
      dash: trajectory.constant ? 'dash' : 'solid',
      constant: trajectory.constant,
    }))} />;
}

export function LogisticTrajectoryPlot({ label, series, time, start, end }: PlotPosition & {
  label: string;
  series: PlotSeries[];
}) {
  const target = useRef<HTMLDivElement>(null);
  const instance = useRef<typeof Plotly>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const element = target.current;
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
      if (element?.classList.contains('js-plotly-plot')) {
        void Promise.resolve().then(() => instance.current?.Plots.resize(element)).catch(() => {});
      }
    }) : undefined;
    if (element) observer?.observe(element);
    return () => {
      observer?.disconnect();
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
      const traces: Plotly.Data[] = series.flatMap(({ name, points, current, color, dash, constant }) => {
        const hasReading = current !== null && current !== undefined;
        const curve: Plotly.Data = {
          type: 'scatter',
          mode: 'lines',
          name,
          x: points.map(p => p.time),
          y: points.map(p => p.value),
          line: { color, dash, width: 2.5, shape: 'linear' },
          hovertemplate: constant
            ? 'Équilibre maintenu · %{y} t<extra>%{fullData.name}</extra>'
            : '%{y} t à %{x} mois<extra>%{fullData.name}</extra>',
        };
        const marker: Plotly.Data = {
          type: 'scatter',
          mode: 'markers',
          name,
          x: hasReading ? [time] : [],
          y: hasReading ? [current] : [],
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

  return <div className={styles.chart} role="img" aria-label={label}
    data-time={time} data-series={series.map(item => item.name).join(',')}>
    <div className={styles.plot} ref={target} hidden={!!error} />
    {error && <p role="alert" className={styles.chartMessage}>{error}</p>}
  </div>;
}
