import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SimulationWorkspace } from '@/components/simulation/simulation-workspace';
import { workshopFixture } from './workshop-fixture';
vi.mock('next/dynamic', () => ({ default: () => () => <div data-testid="workshop-chart" /> }));
vi.mock('@/components/panels/results-panel', () => ({ ResultsPanel: () => <div>Sorties scientifiques conservées</div> }));
beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, 'matchMedia', { writable: true, value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }) });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
function start() { const fixture = workshopFixture(); return { ...render(<SimulationWorkspace {...fixture} status="Terminé" stale={false} active />), ...fixture }; }
describe('Workshop presentation and player', () => {
  it('shows explicit empty and error states without demonstration data', () => {
    render(<SimulationWorkspace status="Échec" stale={false} active error="ENGINE_UNAVAILABLE" />);
    expect(screen.getByText('Aucune simulation pour le moment')).toBeVisible(); expect(screen.getByRole('alert')).toHaveTextContent('ENGINE_UNAVAILABLE');
    expect(screen.queryByLabelText('Position temporelle')).not.toBeInTheDocument();
  });
  it('keeps time and run while switching audience, and restarts without API requests', () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher); start();
    fireEvent.change(screen.getByLabelText('Seuil choisi pour l’atelier', { exact: true }), { target: { value: '140' } });
    fireEvent.change(screen.getByLabelText('Position temporelle'), { target: { value: '3' } });
    expect(screen.getByRole('heading', { name: 'DANGER : SEUIL FRANCHI' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Scientifique' }));
    expect(screen.getByText('Sorties scientifiques conservées')).toBeVisible(); expect(screen.getByLabelText('Position temporelle')).toHaveValue('3');
    fireEvent.click(screen.getByRole('button', { name: 'Lecture pêcheur' })); expect(screen.getByRole('heading', { name: 'DANGER : SEUIL FRANCHI' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Recommencer' })); expect(screen.getByLabelText('Position temporelle')).toHaveValue('0'); expect(fetcher).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Son des alertes')).not.toBeChecked(); expect(screen.getByText(/unités physiques/i)).toBeInTheDocument();
  });
  it('plays, pauses, resumes and uses the same observations at a faster speed', () => {
    vi.useFakeTimers(); start();
    fireEvent.click(screen.getByRole('button', { name: 'Lancer l’animation' })); act(() => vi.advanceTimersByTime(5000));
    expect(screen.getByLabelText('Position temporelle')).toHaveValue('1'); fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    act(() => vi.advanceTimersByTime(20000)); expect(screen.getByLabelText('Position temporelle')).toHaveValue('1');
    fireEvent.change(screen.getByLabelText('Vitesse de lecture'), { target: { value: '2' } }); fireEvent.click(screen.getByRole('button', { name: 'Reprendre' }));
    act(() => vi.advanceTimersByTime(2500)); expect(screen.getByLabelText('Position temporelle')).toHaveValue('2');
  });
  it('sounds only at alert entries during continuous playback and never on seek or restart', async () => {
    vi.useFakeTimers(); const beep = vi.fn();
    class FakeAudio { state = 'running'; currentTime = 0; destination = {}; resume = async () => {}; close = async () => {}; createOscillator() { return { connect() {}, disconnect() {}, frequency: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {} }, start: beep, stop() {} }; } createGain() { return { connect() {}, disconnect() {}, gain: { value: 0, cancelScheduledValues() {}, setValueAtTime() {}, setTargetAtTime() {}, linearRampToValueAtTime() {} } }; } }
    vi.stubGlobal('AudioContext', FakeAudio); start();
    fireEvent.change(screen.getByLabelText('Seuil choisi pour l’atelier', { exact: true }), { target: { value: '140' } });
    await act(async () => { fireEvent.click(screen.getByLabelText('Son des alertes')); });
    expect(beep).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: 'Lancer l’animation' }));
    act(() => vi.advanceTimersByTime(5000)); act(() => vi.advanceTimersByTime(5000)); expect(beep).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(5000)); expect(beep).toHaveBeenCalledTimes(3); // Voice + slow modulation for red.
    act(() => vi.advanceTimersByTime(5000)); expect(beep).toHaveBeenCalledTimes(3);
    fireEvent.change(screen.getByLabelText('Position temporelle'), { target: { value: '2' } }); expect(beep).toHaveBeenCalledTimes(3);
    fireEvent.click(screen.getByRole('button', { name: 'Recommencer' })); expect(beep).toHaveBeenCalledTimes(3);
  });
  it('switches real scenarios and resets their player and workshop threshold', () => {
    start(); fireEvent.change(screen.getByLabelText('Seuil choisi pour l’atelier', { exact: true }), { target: { value: '140' } });
    fireEvent.change(screen.getByLabelText('Position temporelle'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Situation simulée'), { target: { value: 'prospectives:1:1' } });
    expect(screen.getByLabelText('Position temporelle')).toHaveValue('0'); expect(screen.getByLabelText('Seuil choisi pour l’atelier', { exact: true })).toHaveValue(null);
    expect(screen.getByText('320')).toBeVisible();
  });
  it('keeps scientific decisions available when no trajectories were requested', () => {
    const fixture = workshopFixture(); fixture.result.observations = []; if (fixture.result.schemaVersion === 2) fixture.result.scenarioTrajectories = [];
    render(<SimulationWorkspace {...fixture} status="Terminé" stale={false} active />);
    fireEvent.click(screen.getByRole('button', { name: 'Scientifique' }));
    expect(screen.getByText('Sorties scientifiques conservées')).toBeVisible();
  });
  it('keeps visual alerts when browser audio is refused', async () => {
    vi.stubGlobal('AudioContext', class { constructor() { throw new Error('Audio blocked'); } });
    start(); await act(async () => { fireEvent.click(screen.getByLabelText('Son des alertes')); });
    expect(screen.getByLabelText('Son des alertes')).not.toBeChecked();
    expect(screen.getByText(/Le navigateur ne permet pas le son/)).toBeVisible();
    fireEvent.change(screen.getByLabelText('Seuil choisi pour l’atelier', { exact: true }), { target: { value: '140' } });
    fireEvent.change(screen.getByLabelText('Position temporelle'), { target: { value: '3' } });
    expect(screen.getByRole('heading', { name: 'DANGER : SEUIL FRANCHI' })).toBeVisible();
  });
});
