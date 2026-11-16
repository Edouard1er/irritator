import React, { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { applyTerritorialZone, type RunRequest } from '@contracts';
import { territoryDemo } from '@/lib/modeling/territory-demo';
import { TerritoryWorkspace } from '@/components/territory/territory-workspace';
import model from '../../../examples/atelier-interventions-month-v3.json';

function Harness() {
  const [request, setRequest] = useState(structuredClone(model) as unknown as RunRequest);
  return <><TerritoryWorkspace request={request} busy={false} onApply={setRequest} onSimulation={vi.fn()}/><output data-testid="request">{JSON.stringify(request)}</output></>;
}
const demo = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Scientifique' }));
  fireEvent.click(screen.getByRole('button', { name: 'Essayer la démonstration fictive' }));
  fireEvent.click(screen.getByRole('button', { name: 'Pêcheur' }));
};
describe('Territory fisher and scientific views', () => {
  it('shows the exact scientific coefficient without display rounding', () => {
    const data = structuredClone(territoryDemo); data.features[1]!.properties.accessibility = .123456789;
    const request = applyTerritorialZone(structuredClone(model) as unknown as RunRequest, data, 'demo-A');
    render(<TerritoryWorkspace request={request} busy={false} onApply={vi.fn()} onSimulation={vi.fn()}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Scientifique' }));
    expect(screen.getByText('0,123456789', { exact: true })).toBeVisible();
  });
  it('starts with a clear absent-data state and no invented geometry', () => {
    render(<Harness/>); expect(screen.getByText('Les zones restent à renseigner')).toBeVisible();
    expect(screen.queryByRole('group', { name: /Carte fictive/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirmer cette zone' })).toBeDisabled();
  });
  it('selects one zone by click or keyboard without changing the scientific request until confirmation', () => {
    render(<Harness/>); const before = screen.getByTestId('request').textContent; demo();
    fireEvent.click(screen.getByRole('button', { name: 'Zone fictive A' }));
    expect(screen.getByText('10 %')).toBeVisible(); expect(screen.getByTestId('request').textContent).toBe(before);
    const b = screen.getByRole('button', { name: 'Sur la carte : Zone fictive B' }); b.focus(); fireEvent.keyDown(b, { key: 'Enter' });
    expect(b).toHaveAttribute('aria-pressed', 'true'); expect(screen.getByRole('button', { name: 'Sur la carte : Zone fictive A' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.keyDown(screen.getByRole('button', { name: 'Sur la carte : Zone fictive A' }), { key: ' ' });
    expect(b).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Préparer la simulation' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer cette zone' }));
    const applied = JSON.parse(screen.getByTestId('request').textContent!); expect(applied.temporal.parameters.a).toBe(.1); expect(applied.territory.zoneId).toBe('demo-A');
    expect(screen.getByText('✓ Zone confirmée')).toBeVisible(); expect(screen.getByRole('button', { name: 'Préparer la simulation' })).toBeEnabled();
  });
  it('keeps draft selection across the two readings and separates scientific details', () => {
    render(<Harness/>); demo(); fireEvent.click(screen.getByRole('button', { name: 'Zone fictive A' }));
    expect(screen.queryByText('Identifiant de zone')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Scientifique' }));
    const science = screen.getByText('Traçabilité scientifique').closest('div')!;
    expect(within(science).getByText('demo-A', { exact: true })).toBeVisible(); expect(within(science).getByText('synthetic-demo-v1')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Pêcheur' }));
    expect(screen.getByText('10 %')).toBeVisible(); expect(screen.getByRole('button', { name: 'Sur la carte : Zone fictive A' })).toHaveAttribute('aria-pressed', 'true');
  });
  it('does not lose the applied configuration when another zone is only being prepared', () => {
    render(<Harness/>); demo(); fireEvent.click(screen.getByRole('button', { name: 'Zone fictive A' })); fireEvent.click(screen.getByRole('button', { name: 'Confirmer cette zone' }));
    const applied = screen.getByTestId('request').textContent;
    fireEvent.click(screen.getByRole('button', { name: 'Zone fictive B' }));
    expect(screen.getByText('Zone à confirmer')).toBeVisible(); expect(screen.getByText('40 %')).toBeVisible();
    expect(screen.getByTestId('request').textContent).toBe(applied); expect(screen.getByRole('button', { name: 'Préparer la simulation' })).toBeDisabled();
  });
  it('preserves the previous selection on an invalid local upload', async () => {
    render(<Harness/>); demo(); fireEvent.click(screen.getByRole('button', { name: 'Zone fictive A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Scientifique' }));
    fireEvent.change(screen.getByLabelText('Charger un GeoJSON local'), { target: { files: [{ size: 100, text: async () => '{"type":"Point"}' }] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Chargement impossible');
    fireEvent.click(screen.getByRole('button', { name: 'Pêcheur' }));
    expect(screen.getByRole('alert')).not.toHaveTextContent(/GeoJSON|Collection|contrat/); expect(screen.getByText('10 %')).toBeVisible();
  });
  it('reserves geographic commands and technical metadata for scientists, preserving the same values and selection', () => {
    render(<Harness/>);
    const territory = screen.getByRole('region', { name: 'Territoire — Lac de Guiers' });
    expect(within(territory).queryByLabelText('Charger un GeoJSON local')).not.toBeInTheDocument();
    expect(within(territory).queryByRole('button', { name: 'Essayer la démonstration fictive' })).not.toBeInTheDocument();
    expect(territory).not.toHaveTextContent(/GeoJSON|contrat|QSS|DEVS|paramètres|fichier/i);
    demo(); fireEvent.click(screen.getByRole('button', { name: 'Zone fictive A' }));
    expect(territory.querySelectorAll('input[type="file"]')).toHaveLength(0);
    expect(within(territory).getAllByText('Carte de démonstration — zones fictives.')).toHaveLength(1);
    expect(territory).not.toHaveTextContent(/WGS84|SCHÉMA FICTIF|Ce dessin|N\(t\)|a_z|non calibr|source|provenance|synthétique/i);
    const metrics = territory.querySelector('.territory-metrics')!;
    expect(metrics).toHaveTextContent('Poissons dans tout le lac150 t');
    expect(metrics).toHaveTextContent('Accès aux poissons10 %');
    expect(metrics).toHaveTextContent('Poissons accessibles dans cette zone15 t');
    const before = screen.getByTestId('request').textContent;
    fireEvent.click(screen.getByRole('button', { name: 'Scientifique' }));
    expect(screen.getByLabelText('Charger un GeoJSON local')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Essayer la démonstration fictive' })).toBeVisible();
    expect(territory).toHaveTextContent('demo-A'); expect(territory).toHaveTextContent('a_z × N(t)');
    expect(territory).toHaveTextContent('Valeur pédagogique fictive A');
    fireEvent.click(screen.getByRole('button', { name: 'Pêcheur' }));
    expect(screen.getByRole('button', { name: 'Sur la carte : Zone fictive A' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('request').textContent).toBe(before);
    expect(territory.querySelector('.territory-metrics')).toHaveTextContent('Poissons accessibles dans cette zone15 t');
  });
  it('keeps declared geographic sources available only in the scientific reading', () => {
    const data = structuredClone(territoryDemo); data.demonstration = false; data.source = 'source-test-reservee-science';
    const request = applyTerritorialZone(structuredClone(model) as unknown as RunRequest, data, 'demo-A');
    render(<TerritoryWorkspace request={request} busy={false} onApply={vi.fn()} onSimulation={vi.fn()}/>);
    expect(screen.queryByText(/source-test-reservee-science/)).not.toBeInTheDocument();
    expect(screen.queryByText('Carte de démonstration — zones fictives.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Scientifique' }));
    expect(screen.getAllByText(/source-test-reservee-science/).length).toBeGreaterThan(0);
  });
});
