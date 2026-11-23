import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WorkshopChart from '@/components/simulation/workshop-chart';
import { statusInfo, type AlertConfig, type BiomassStatus, type Series } from '@/lib/simulation/trajectory';

const plotly = vi.hoisted(() => ({
  react: vi.fn<(...args: unknown[]) => Promise<void>>(),
  purge: vi.fn(),
  Plots: { resize: vi.fn() },
}));
vi.mock('@/components/charts/trajectory-plot', () => ({ loadPlotly: async () => plotly }));

type Trace = {
  name: string;
  mode: string;
  x: (number | null)[];
  y: (number | null)[];
  line: { color: string; dash?: string; shape?: string };
};
type Layout = {
  xaxis: { range: number[]; title: { text: string } };
  yaxis: { title: { text: string } };
  shapes: { type: string; x0: number; x1: number; y0: number; y1: number; line?: { color?: string } }[];
  annotations: { text: string }[];
};

function fixture() {
  const series: Series = {
    id: 'N', kind: 'biomass_total', unit: 't',
    points: Array.from({ length: 25 }, (_, time) => ({ time, value: 150 + time })),
  };
  // The comparison has its own observation grid, so clipping by the active
  // trajectory's index would reveal observations beyond the selected time.
  const baseline: Series = {
    id: 'N-initial', kind: 'biomass_total', unit: 't',
    points: [0, 2.5, 3, 3.5, 7.5, 8, 8.5, 24].map(time => ({ time, value: 250 + time })),
  };
  const statuses: BiomassStatus[] = series.points.map((_, i) =>
    (['unknown', 'favorable', 'declining', 'near_threshold', 'critical_crossed'] as const)[i % 5]!);
  const config: AlertConfig = { bCrit: 100, proximityRatio: 0.2, slopeTolerance: 0.01 };
  return { series, baseline, statuses, config };
}

const traces = () => plotly.react.mock.lastCall![1] as Trace[];
const layout = () => plotly.react.mock.lastCall![2] as Layout;
const activeTraces = () => traces().filter(trace => trace.name !== 'Trajectoire initiale');
const times = (values: Trace[]) => [...new Set(values.flatMap(trace => trace.x.filter((x): x is number => x !== null)))].sort((a, b) => a - b);
async function rendered(calls: number) { await waitFor(() => expect(plotly.react).toHaveBeenCalledTimes(calls)); }

beforeEach(() => {
  plotly.react.mockReset().mockResolvedValue(undefined);
  plotly.purge.mockClear();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
});
afterEach(() => vi.unstubAllGlobals());

describe('Biomass chart reveals only observations already reached by playback', () => {
  it.each([0, 3, 8, 24])('passes only observations through month %s to Plotly, including its hover data', async time => {
    const { baseline: _baseline, ...props } = fixture();
    const original = structuredClone(props);
    render(<WorkshopChart {...props} biomass timeUnit="mois" index={time} time={time} />);
    await rendered(1);

    expect(times(traces())).toEqual(props.series.points.filter(p => p.time <= time).map(p => p.time));
    expect(traces().some(trace => trace.name === 'Suite enregistrée (non lue)')).toBe(false);
    for (const trace of traces()) {
      expect(trace.x).toHaveLength(trace.y.length);
      trace.x.forEach((at, i) => {
        if (at !== null) {
          expect(at).toBeLessThanOrEqual(time);
          expect(trace.y[i]).toBe(props.series.points.find(p => p.time === at)!.value);
        }
      });
    }
    expect(props).toEqual(original);
    expect(layout().xaxis.range).toEqual([0, 24]);
  });

  it('removes future observations again when seeking backwards, then reveals them on replay', async () => {
    const { baseline: _baseline, ...props } = fixture();
    const view = render(<WorkshopChart {...props} biomass timeUnit="mois" index={24} time={24} />);
    await rendered(1);
    for (const [i, time] of [8, 3, 0, 3, 8, 24].entries()) {
      view.rerender(<WorkshopChart {...props} biomass timeUnit="mois" index={time} time={time} />);
      await rendered(i + 2);
      expect(times(traces())).toEqual(props.series.points.filter(p => p.time <= time).map(p => p.time));
    }
  });

  it('uses simulated time rather than an index that already points farther ahead', async () => {
    const { baseline: _baseline, ...props } = fixture();
    render(<WorkshopChart {...props} biomass timeUnit="mois" index={24} time={3.5} />);
    await rendered(1);
    expect(times(traces())).toEqual([0, 1, 2, 3]);
  });

  it('keeps the visible prefix unchanged while the selected time is paused', async () => {
    const { baseline: _baseline, ...props } = fixture();
    const view = render(<WorkshopChart {...props} biomass timeUnit="mois" index={8} time={8} />);
    await rendered(1);
    const before = structuredClone(traces());
    // A presentation setting can rerender while playback remains paused.
    view.rerender(<WorkshopChart {...props} config={{ ...props.config }} biomass timeUnit="mois" index={8} time={8} />);
    await rendered(2);
    expect(traces()).toEqual(before);
    expect(times(traces())).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it.each([0, 3, 8, 24])('clips the dotted initial comparison independently at month %s', async time => {
    const props = fixture();
    const original = structuredClone(props);
    render(<WorkshopChart {...props} biomass timeUnit="mois" index={time} time={time} />);
    await rendered(1);
    const baseline = traces().find(trace => trace.name === 'Trajectoire initiale')!;
    expect(baseline).toBeDefined();
    expect(baseline.x).toEqual(props.baseline.points.filter(p => p.time <= time).map(p => p.time));
    expect(baseline.y).toEqual(props.baseline.points.filter(p => p.time <= time).map(p => p.value));
    expect(baseline.line).toMatchObject({ color: '#657eaa', dash: 'dash' });
    if (time === 0) expect(baseline.mode).toContain('markers');
    expect(times(activeTraces())).toEqual(props.series.points.filter(p => p.time <= time).map(p => p.time));
    expect(props).toEqual(original);
  });

  it('also removes initial comparison values on every backward seek', async () => {
    const props = fixture();
    const view = render(<WorkshopChart {...props} biomass timeUnit="mois" index={24} time={24} />);
    await rendered(1);
    for (const [i, time] of [8, 3, 0].entries()) {
      view.rerender(<WorkshopChart {...props} biomass timeUnit="mois" index={time} time={time} />);
      await rendered(i + 2);
      const baseline = traces().find(trace => trace.name === 'Trajectoire initiale')!;
      expect(baseline.x).toEqual(props.baseline.points.filter(p => p.time <= time).map(p => p.time));
      expect(baseline.y).toEqual(props.baseline.points.filter(p => p.time <= time).map(p => p.value));
      expect(times(traces()).every(at => at <= time)).toBe(true);
    }
  });

  it('retains the full temporal axis, alert thresholds and status colors at the initial instant', async () => {
    const { baseline: _baseline, ...props } = fixture();
    render(<WorkshopChart {...props} biomass timeUnit="mois" index={0} time={0} />);
    await rendered(1);
    expect(layout().xaxis).toMatchObject({ range: [0, 24], title: { text: 'Temps simulé (mois)' } });
    expect(layout().yaxis.title.text).toBe('Biomasse (t)');
    expect(layout().shapes).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'rect', y0: 100, y1: 120 }),
      expect.objectContaining({ type: 'line', y0: 100, y1: 100, line: { color: '#b52b3b', dash: 'dash', width: 2 } }),
    ]));
    expect(layout().annotations.map(annotation => annotation.text)).toEqual(expect.arrayContaining([
      'Seuil d’atelier : 100', 'Zone d’alerte ≤ 120',
    ]));
    for (const status of Object.values(statusInfo)) {
      expect(traces().find(trace => trace.name === status.title)?.line.color).toBe(status.color);
    }
    const initial = traces().find(trace => trace.x.includes(0))!;
    expect(initial.mode).toContain('markers');
  });
});
