'use client';

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import referenceData from '@/data/geography/guiers-metric-reference.json';
import connectivityData from '@/data/geography/guiers-connectivity-h.json';
import { errorText, runSimulation } from '@/lib/api/client';
import type { GeoAtlasFeature } from '../../../../packages/contracts/geo-atlas';
import {
  guiersGrid, guiersIdentity, guiersResolutions, maxGuiersCandidateBytes, parseGuiersCandidate,
  type GuiersCandidate, type GuiersConfiguration, type GuiersConnectivity, type GuiersGrid, type GuiersReference, type GuiersResolution,
} from '../../../../packages/contracts/guiers-spatial';
import { guiersLogisticDefaults, runGuiersLogistic, type GuiersLogisticResult } from '../../../../examples/guiers-logistic';
import { GeoAtlasMap, type AtlasMapLayers } from './geo-atlas-map';

const reference = referenceData as unknown as GuiersReference;
const hydro = reference.geometry;
const noFeatures: GeoAtlasFeature[] = [];
const labels = { H: 'H — HydroLAKES', E: 'E — contour alternatif', H_PLUS: 'H+ — hybride candidate',
  HP_PLUS: 'Lac de Guiers — domaine de pêche en pirogue (candidat)' };
const themeOptions = [
  ['villages', 'Villages candidats'],
  ['zoneExclusionPeche', 'Zones de scénario (à confirmer)'],
  ['tipha_theoric', 'Typha théorique'],
] as const;
type Theme = typeof themeOptions[number][0];
type LocalImport = { candidate: GuiersCandidate; sha: string };
const fmt = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 });
const maxResultBytes = 16 * 1024 * 1024;

function gridSummary(grid: GuiersGrid) {
  return {
    area: fmt.format(grid.areaM2 / 1e6),
    partial: grid.cells.filter(c => c.cellAreaM2 - c.waterAreaM2 > 0.001).length,
    multipart: grid.cells.filter(c => c.waterComponentCount > 1).length,
  };
}

function importResult(raw: string, identity: string, grid: GuiersGrid): GuiersLogisticResult {
  const r = JSON.parse(raw) as Partial<GuiersLogisticResult> | null;
  const p = r?.parameters;
  if (r?.kind !== 'irritator.guiers.autonomous-result' || r.version !== 1 || r.identity !== identity ||
    !p || !Number.isInteger(p.days) || p.days < 1 || p.days > 365 ||
    !Number.isFinite(p.capacityKgM2) || p.capacityKgM2 <= 0 || !Number.isFinite(p.initialKgM2) ||
    p.initialKgM2 < 0 || p.initialKgM2 > p.capacityKgM2 || !Number.isFinite(p.growthPerDay) || p.growthPerDay < 0 ||
    !Array.isArray(r.cells) || r.cells.length !== grid.cells.length) {
    throw new Error('Résultat incompatible avec cette configuration et cette résolution.');
  }
  for (const [i, series] of r.cells.entries()) {
    const cell = grid.cells[i]!;
    const k = p.capacityKgM2 * cell.waterAreaM2;
    if (series?.id !== cell.id || !Array.isArray(series.samples) || !series.samples.length ||
      series.samples.length > p.days*10+2 || series.samples[0]?.time !== 0 ||
      Math.abs(series.samples[0].value - p.initialKgM2 * cell.waterAreaM2) > 1e-9 * Math.max(1, k) ||
      series.samples.some((s, j) => !s || !Number.isFinite(s.time) || !Number.isFinite(s.value) || s.time < 0 ||
        s.time > p.days || (j > 0 && s.time <= series.samples[j-1]!.time) ||
        s.value < 0 || s.value > k + Math.max(5e-9, k * 1.5e-6))) {
      throw new Error('Séries de biomasse ou identifiants de cellules incohérents.');
    }
  }
  return r as GuiersLogisticResult;
}

function resultAt(result: GuiersLogisticResult, grid: GuiersGrid, time: number) {
  const [west, south] = grid.displayBoundsIndices;
  let total = 0;
  const density = grid.cells.map((cell, i) => {
    const x = cell.xIndex - west, y = cell.yIndex - south;
    const samples = result.cells[i]!.samples;
    const value = samples.findLast(s => s.time <= time + 1e-9)!.value;
    total += value;
    const kgM2 = value / cell.waterAreaM2;
    const contrast = Math.min(1, kgM2 / result.parameters.capacityKgM2);
    const corners = [grid.gridLines[x]![y]!, grid.gridLines[x+1]![y]!, grid.gridLines[x+1]![y+1]!, grid.gridLines[x]![y+1]!];
    return { id: cell.id, corners, kgM2, fill: `hsl(203 75% ${92 - 51*contrast}%)` };
  });
  return { density, total };
}

export default function GuiersSpatialWorkspace({ scientific }: { scientific: boolean }) {
  const [local, setLocal] = useState<LocalImport>();
  const [pending, setPending] = useState<LocalImport>();
  const [configuration, setConfiguration] = useState<GuiersConfiguration>('H');
  const [resolution, setResolution] = useState<GuiersResolution>(1000);
  const [visibleThemes, setVisibleThemes] = useState<Theme[]>(['villages']);
  const [showGrid, setShowGrid] = useState(false), [showAlternate, setShowAlternate] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<GuiersLogisticResult>();
  const [day, setDay] = useState(0);
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController>(undefined);
  const readVersion = useRef(0);
  useEffect(() => () => controller.current?.abort(), []);
  const candidate = local?.candidate;
  const grid = guiersGrid(reference, configuration, resolution, candidate) ?? reference.grids[resolution];
  const identity = guiersIdentity(configuration, resolution, reference.hydroSha256, local?.sha);
  const alternative = candidate?.layers.lac?.[0]?.geometry;
  const fishing = candidate?.fishingDomain;
  const activeFishing = configuration === 'HP_PLUS' ? fishing : undefined;
  const enriched = configuration === 'H_PLUS' || configuration === 'HP_PLUS';
  const localRunner = configuration === 'E' || configuration === 'HP_PLUS';
  const themes = enriched ? candidate?.layers : undefined;
  const villageStatuses = new Map(activeFishing?.villages.map(v => [v.id, v]));
  const geometryConnectivity = configuration === 'H' || configuration === 'H_PLUS' ?
    (connectivityData.hydroSha256 === reference.hydroSha256 ? connectivityData.grids[resolution] as GuiersConnectivity : undefined) :
    candidate?.connectivity?.[`${configuration}_${resolution}`];
  const activeResult = result?.identity === identity ? result : undefined;
  const frame = activeResult && resultAt(activeResult, grid, day);
  const summary = gridSummary(grid);
  const layers: AtlasMapLayers = {
    frame: hydro,
    water: activeFishing?.geometry ?? (configuration === 'E' && alternative ? alternative : hydro),
    alternate: showAlternate && alternative ? (configuration === 'E' ? hydro : alternative) : undefined,
    removed: showAlternate ? activeFishing?.removedGeometry ?? undefined : undefined,
    cut: showAlternate ? activeFishing?.boundsCutWgs84 : undefined,
    clipAreasToWater: Boolean(activeFishing),
    grid: showGrid ? grid.gridLines : undefined,
    density: frame ? frame.density : undefined,
    areas: [
      ...(visibleThemes.includes('zoneExclusionPeche') ? (themes?.zoneExclusionPeche ?? []).map(f =>
        ({ id: f.id, geometry: f.geometry, kind: 'reserve' as const, label: 'Zone de scénario (à confirmer)' })) : []),
      ...(visibleThemes.includes('tipha_theoric') ? (themes?.tipha_theoric ?? []).map(f =>
        ({ id: f.id, geometry: f.geometry, kind: 'typha' as const, label: 'Typha théorique' })) : []),
    ],
    points: visibleThemes.includes('villages') ? (themes?.villages ?? []).map(f =>
      ({ id: f.id, coordinates: f.geometry.coordinates, outside: villageStatuses.get(f.id)?.insideWater === false,
        label: f.properties.name ?? 'Village sans nom renseigné' })) : [],
    legend: ['Eau', showAlternate && alternative && 'Tirets : contour de comparaison', showGrid && 'Quadrillage : cellules',
      showAlternate && activeFishing?.removedGeometry && 'Ocre : eau hors du périmètre étudié',
      showAlternate && Boolean(activeFishing?.boundsCutWgs84.length) && 'Rouge : coupure dans l’eau',
      activeFishing && themes?.villages && visibleThemes.includes('villages') && 'Cercle ouvert : village hors de l’eau',
      frame && 'Bleu foncé : densité plus élevée', ...themeOptions.map(([key, label]) => themes?.[key] && visibleThemes.includes(key) && label)]
      .filter(Boolean).join(' · '),
  };

  async function readCandidate(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const version = ++readVersion.current;
    setPending(undefined);
    try {
      if (file.size > maxGuiersCandidateBytes) throw new Error('Fichier SIG trop volumineux (5 Mio maximum).');
      const bytes = await file.arrayBuffer();
      const next = parseGuiersCandidate(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes), reference);
      const sha = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
      if (version === readVersion.current) { setPending({ candidate: next, sha }); setError(''); }
    } catch (cause) {
      if (version === readVersion.current) setError(errorText(cause));
    }
  }

  async function readResult(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      if (file.size > maxResultBytes) throw new Error('Résultat trop volumineux (16 Mio maximum).');
      const next = importResult(await file.text(), identity, grid);
      setResult(next); setDay(next.parameters.days); setError('');
    } catch (cause) { setError(errorText(cause)); }
  }

  async function simulate() {
    if (busy || localRunner) return;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true); setError('');
    try {
      // The server receives only the public H cell areas and the autonomous demonstration.
      const next = await runGuiersLogistic(reference.grids[resolution], identity, guiersLogisticDefaults,
        request => runSimulation(request, abort.signal));
      if (!abort.signal.aborted) { setResult(next); setDay(next.parameters.days); }
    } catch (cause) { if (!abort.signal.aborted) setError(errorText(cause)); }
    finally { if (!abort.signal.aborted) setBusy(false); }
  }

  return <section className="geo-sig" aria-label="Référentiel SIG du lac">
    <div className="geo-sig-controls">
      <label>Configuration <select value={configuration} onChange={e => setConfiguration(e.target.value as GuiersConfiguration)}>
        <option value="H">{labels.H}</option>
        <option value="E" disabled={!alternative}>{labels.E}</option>
        <option value="H_PLUS" disabled={!guiersGrid(reference, 'H_PLUS', resolution, candidate)}>{labels.H_PLUS}</option>
        <option value="HP_PLUS" disabled={!fishing}>{labels.HP_PLUS}</option>
        {scientific && <option value="L_V_PLUS" disabled>Lv+ — validation requise</option>}
      </select></label>
      <label>Résolution <select value={resolution} onChange={e => setResolution(Number(e.target.value) as GuiersResolution)}>
        {guiersResolutions.map(h => <option key={h} value={h}>{h === 1000 ? '1 km' : '500 m'}</option>)}
      </select></label>
      <label><input type="checkbox" checked={showGrid} onChange={e => setShowGrid(e.target.checked)}/> Grille</label>
      {(alternative || activeFishing?.removedGeometry) && <label><input type="checkbox" checked={showAlternate} onChange={e => setShowAlternate(e.target.checked)}/> Comparer les contours</label>}
    </div>
    <p className="geo-status">{configuration === 'E' ? 'Contour alternatif à vérifier sur le terrain.' :
      configuration === 'H_PLUS' ? 'Contour historique HydroLAKES et couches candidates.' : activeFishing ?
        `Le périmètre proposé pour étudier la pêche en pirogue ${activeFishing.mask.id === 'south_cut_min_northing_E_v1' ?
          'exclut l’extension sud' : 'suit la limite fournie par le chercheur'}. La limite reste à vérifier avec les acteurs du lac.` : 'Contour historique HydroLAKES.'}
      {!candidate && ' Les couches locales complémentaires sont indisponibles.'}
      {scientific && !fishing && ' Le périmètre de pêche candidat devient disponible après activation d’un référentiel local V2 autorisé.'}</p>
    {enriched && <fieldset className="geo-sig-controls"><legend>Couches à afficher</legend>
      {themeOptions.map(([key, label]) => <label key={key}><input type="checkbox" disabled={!themes?.[key]} checked={Boolean(themes?.[key] && visibleThemes.includes(key))}
        onChange={e => setVisibleThemes(e.target.checked ? [...visibleThemes, key] : visibleThemes.filter(x => x !== key))}/>
        {' '}{label}{!themes?.[key] && ' — indisponible'}</label>)}
    </fieldset>}
    <div className="geo-map-card"><GeoAtlasMap features={noFeatures} onSelect={() => {}} layers={layers}/></div>
    {enriched && themes?.villages && visibleThemes.includes('villages') && <details>
      <summary>Villages affichés</summary>
      <ul className="geo-sig-villages">{themes.villages.map(v => <li key={v.id}>{v.properties.name ?? 'Village sans nom renseigné'}
        {villageStatuses.get(v.id)?.insidePerimeterMask === false ? ' · hors du périmètre' :
          villageStatuses.get(v.id)?.insideWater === false && ' · hors de l’eau'}</li>)}</ul>
    </details>}
    {activeResult && frame && <div>
      <label>Jour {day} <input type="range" min="0" max={activeResult.parameters.days} value={day} onChange={e => setDay(Number(e.target.value))}/></label>
      <p role="status">Biomasse simulée {fmt.format(frame.total)} kg · paramètres de démonstration.</p>
    </div>}
    {result && !activeResult && <p role="status">Un résultat est disponible pour son référentiel et sa résolution d’origine.</p>}
    {!scientific && <p>{summary.area} km² en eau · {grid.cells.length} cellules actives.</p>}
    {scientific && <div className="geo-science">
      <p>{summary.area} km² en eau · {grid.cells.length} cellules actives · {summary.partial} partielles · {summary.multipart} multiparties · EPSG:32628.</p>
      <p>{reference.source.attribution} · {reference.source.license} · {reference.source.observationContext} · extrait le {reference.source.acquiredAt}.</p>
      <p>Lv+ requiert des preuves empiriques, institutionnelles et de réutilisation pour chaque couche.</p>
      {geometryConnectivity && <details><summary>Connectivité aquatique géométrique</summary>
        <p>Graphe par parties {geometryConnectivity.parts.version} · {geometryConnectivity.parts.components} composante(s) ·
          {' '}{geometryConnectivity.parts.nodes} parties · {geometryConnectivity.parts.edges} interfaces ·
          {' '}{geometryConnectivity.parts.isolatedNodes} isolats ({fmt.format(geometryConnectivity.parts.isolatedAreaM2 / 1e6)} km²).</p>
        <p>Plus grande par aire · {geometryConnectivity.parts.largest.cells} cellules · {fmt.format(geometryConnectivity.parts.largest.areaM2 / 1e6)} km².
          Graphe historique · {geometryConnectivity.legacy.components} composante(s) · {geometryConnectivity.blockedLegacyInterfaces} interfaces bloquées.</p>
        <p>La navigabilité reste à vérifier sur le terrain. La croissance autonome utilise les aires par cellule.</p>
      </details>}
      {activeFishing && <details><summary>Masque candidat et sensibilité</summary>
        <p>{activeFishing.mask.id} · {activeFishing.mask.crs} · {activeFishing.mask.author} · {activeFishing.mask.maskSha256}.</p>
        <p>{activeFishing.mask.justification}</p>
        {activeFishing.mask.southNorthingM !== null && <p>Seuil nord UTM {fmt.format(activeFishing.mask.southNorthingM)} m.</p>}
        {activeFishing.sensitivity && <p>Variante envelope · seuil {fmt.format(activeFishing.sensitivity.southNorthingM)} m ·
          {' '}{fmt.format(activeFishing.sensitivity.retainedKm2)} km² conservés.</p>}
        <p>Frontière fermée et flux nul pour le prototype. Les règles de pêche relèvent d’un référentiel distinct. Les points représentent les villages sources.</p>
      </details>}
      {candidate?.comparison && <Comparison value={candidate.comparison}/>}
      {candidate && <details><summary>Sources locales et anomalies</summary>
        <ul>{Object.values(candidate.sources).map(source => <li key={source.id}>{source.id} · {source.attribution} · {source.version} · acquis le {source.acquiredAt} · contrôle technique déclaré · observation et validation institutionnelle à confirmer · usage local selon {source.rightsEvidence}</li>)}</ul>
        <ul>{candidate.anomalies.map((note, i) => <li key={i}>{note}</li>)}</ul>
      </details>}
      <div className="geo-actions">
        <label>Ouvrir un référentiel candidat local<input type="file" accept=".json,application/json" aria-label="Ouvrir un référentiel candidat local" onChange={e => void readCandidate(e)}/></label>
        {local && <button onClick={() => { ++readVersion.current; setConfiguration('H'); setPending(undefined); setLocal(undefined); setResult(undefined); }}>Fermer les données locales</button>}
      </div>
      {pending && <article className="geo-import-preview">
        <h3>Aperçu avant activation locale</h3>
        <p>{Object.keys(pending.candidate.layers).map(key => `${key} (${pending.candidate.layers[key as keyof GuiersCandidate['layers']]?.length})`).join(' · ')}. Données candidates pour cette session.</p>
        {pending.candidate.fishingDomain && <p>{labels.HP_PLUS} · {gridSummary(pending.candidate.fishingDomain.grids[resolution]).area} km².</p>}
        {pending.candidate.comparison && <Comparison value={pending.candidate.comparison}/>}
        <button onClick={() => {
          setLocal(pending);
          if (!local || !guiersGrid(reference, configuration, resolution, pending.candidate)) {
            setConfiguration(pending.candidate.fishingDomain ? 'HP_PLUS' : pending.candidate.grids[resolution] ? 'H_PLUS' : 'E');
          }
          setPending(undefined);
        }}>Activer le référentiel candidat</button>
        <button onClick={() => setPending(undefined)}>Annuler l’activation</button>
      </article>}
      <div className="geo-actions">
        <button disabled={busy || localRunner} onClick={() => void simulate()}>{busy ? 'Simulation en cours…' : 'Simuler la croissance autonome'}</button>
        <label>Ouvrir un résultat local<input type="file" accept=".json,application/json" aria-label="Ouvrir un résultat local" onChange={e => void readResult(e)}/></label>
      </div>
      {localRunner && <p>Calculez la croissance sur {configuration === 'E' ? 'E' : 'le périmètre candidat'} avec le runner natif local, puis ouvrez le résultat ici.</p>}
    </div>}
    {error && <p className="error-banner" role="alert">{scientific ? error : 'L’opération n’a pas abouti.'}</p>}
  </section>;
}

function Comparison({ value }: { value: NonNullable<GuiersCandidate['comparison']> }) {
  return <p>Commun {fmt.format(value.intersectionKm2)} km² · H seul {fmt.format(value.hydroOnlyKm2)} km² · E seul {fmt.format(value.alternativeOnlyKm2)} km² · Jaccard {fmt.format(value.jaccard)}.</p>;
}
