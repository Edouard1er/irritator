'use client';

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import referenceData from '@/data/geography/guiers-metric-reference.json';
import connectivityData from '@/data/geography/guiers-connectivity-h.json';
import { errorText, runSimulation } from '@/lib/api/client';
import { hasLocalGuiersProfile, localGuiersJson } from '@/lib/api/local-guiers';
import type { GeoAtlasFeature } from '../../../../packages/contracts/geo-atlas';
import {
  guiersGrid, guiersIdentity, guiersResolutions, maxGuiersCandidateBytes, parseGuiersCandidate,
  type GuiersCandidate, type GuiersConfiguration, type GuiersConnectivity, type GuiersGrid, type GuiersReference,
  type GuiersResolution, type GuiersWaterParts,
} from '../../../../packages/contracts/guiers-spatial';
import { guiersLogisticDefaults, runGuiersLogistic, type GuiersLogisticParams, type GuiersLogisticResult } from '../../../../examples/guiers-logistic';
import { GeoAtlasMap, type AtlasMapLayers } from './geo-atlas-map';

const reference = referenceData as unknown as GuiersReference;
const hydro = reference.geometry;
const noFeatures: GeoAtlasFeature[] = [];
const labels = { H: 'H — HydroLAKES', E: 'E — contour d’Étienne Delay', H_PLUS: 'H+ — HydroLAKES enrichi',
  HP_PLUS: 'HP+ — domaine de pêche en pirogue (candidat)' };
const themeOptions = [
  ['villages', 'Villages candidats'],
  ['zoneExclusionPeche', 'Réserves candidates (à confirmer)'],
  ['tipha_theoric', 'Typha théorique'],
] as const;
type Theme = typeof themeOptions[number][0];
type LocalImport = { candidate: GuiersCandidate; sha: string; profile?: { synthetic: boolean; mask: AtlasMapLayers['mask'] } };
const fmt = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 });
const maxResultBytes = 16 * 1024 * 1024;

function gridSummary(grid: GuiersGrid) {
  return {
    area: fmt.format(grid.areaM2 / 1e6),
    partial: grid.cells.filter(c => c.cellAreaM2 - c.waterAreaM2 > 0.001).length,
    multipart: grid.cells.filter(c => c.waterComponentCount > 1).length,
  };
}

function checkedResult(value: unknown, identity: string, grid: GuiersGrid): GuiersLogisticResult {
  const r = value as Partial<GuiersLogisticResult> | null;
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

function cellCorners(grid: GuiersGrid, cell: GuiersGrid['cells'][number]) {
  const [west, south] = grid.displayBoundsIndices;
  const x = cell.xIndex - west, y = cell.yIndex - south;
  return [grid.gridLines[x]![y]!, grid.gridLines[x+1]![y]!, grid.gridLines[x+1]![y+1]!, grid.gridLines[x]![y+1]!];
}

function totalsByDay(result: GuiersLogisticResult) {
  const totals = Array<number>(result.parameters.days + 1).fill(0);
  for (const { samples } of result.cells) {
    let index = 0;
    for (let day = 0; day < totals.length; day++) {
      while (samples[index + 1] && samples[index + 1]!.time <= day + 1e-9) index++;
      totals[day]! += samples[index]!.value;
    }
  }
  return totals;
}

function resultAt(result: GuiersLogisticResult, grid: GuiersGrid, time: number) {
  return grid.cells.map((cell, i) => {
    const samples = result.cells[i]!.samples;
    const value = samples.findLast(s => s.time <= time + 1e-9)!.value;
    const kgM2 = value / cell.waterAreaM2;
    const contrast = Math.min(1, kgM2 / result.parameters.capacityKgM2);
    return { id: cell.id, corners: cellCorners(grid, cell), value, kgM2, fill: `hsl(203 75% ${92 - 51*contrast}%)` };
  });
}

export default function GuiersSpatialWorkspace({ scientific }: { scientific: boolean }) {
  const [local, setLocal] = useState<LocalImport>();
  const [pending, setPending] = useState<LocalImport>();
  const [configuration, setConfiguration] = useState<GuiersConfiguration>('H');
  const [resolution, setResolution] = useState<GuiersResolution>(1000);
  const [visibleThemes, setVisibleThemes] = useState<Theme[]>(['villages']);
  const [showGrid, setShowGrid] = useState(false), [showAlternate, setShowAlternate] = useState(false);
  const [showVillageNames, setShowVillageNames] = useState(false);
  const [showMask, setShowMask] = useState(false);
  const [showParts, setShowParts] = useState(false), [showLinks, setShowLinks] = useState(false);
  const [selected, setSelected] = useState<{ identity: string; cellId: string }>();
  const [graph, setGraph] = useState<{ identity: string; parts: GuiersWaterParts }>();
  const [profileStatus, setProfileStatus] = useState('');
  const [error, setError] = useState('');
  const [runs, setRuns] = useState<Record<string, { result: GuiersLogisticResult; totals: number[] }>>({});
  const [parameters, setParameters] = useState(guiersLogisticDefaults);
  const [day, setDay] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController>(undefined);
  const readVersion = useRef(0);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (!hasLocalGuiersProfile()) return;
    const abort = new AbortController();
    const version = readVersion.current;
    setProfileStatus('Recherche du référentiel SIG local…');
    void localGuiersJson('reference', AbortSignal.any([abort.signal, AbortSignal.timeout(10000)])).then(data => {
      const candidate = parseGuiersCandidate(data.raw, reference);
      if (candidate.version !== 2 || !candidate.fishingDomain || !/^[a-f0-9]{64}$/.test(data.sha)) throw new Error('Référentiel V2 requis.');
      if (abort.signal.aborted || version !== readVersion.current) return;
      setLocal({ candidate, sha: data.sha, profile: { synthetic: data.synthetic, mask: data.mask } });
      setConfiguration('HP_PLUS');
      setProfileStatus('');
    }).catch(() => {
      if (!abort.signal.aborted) setProfileStatus('Référentiel automatique indisponible. HydroLAKES est disponible et vous pouvez ouvrir un fichier autorisé.');
    });
    return () => abort.abort();
  }, []);
  const candidate = local?.candidate;
  const grid = guiersGrid(reference, configuration, resolution, candidate) ?? reference.grids[resolution];
  const identity = guiersIdentity(configuration, resolution, reference.hydroSha256, local?.sha);
  const alternative = candidate?.layers.lac?.[0]?.geometry;
  const fishing = candidate?.fishingDomain;
  const activeFishing = configuration === 'HP_PLUS' ? fishing : undefined;
  const enriched = configuration === 'H_PLUS' || configuration === 'HP_PLUS';
  const localRunner = configuration === 'E' || configuration === 'HP_PLUS';
  const profileSha = local?.profile ? local.sha : undefined;
  const themes = enriched ? candidate?.layers : undefined;
  const villageStatuses = new Map(activeFishing?.villages.map(v => [v.id, v]));
  const geometryConnectivity = configuration === 'H' || configuration === 'H_PLUS' ?
    (connectivityData.hydroSha256 === reference.hydroSha256 ? connectivityData.grids[resolution] as GuiersConnectivity : undefined) :
    candidate?.connectivity?.[`${configuration}_${resolution}`];
  const activeRun = runs[identity];
  const activeResult = activeRun?.result;
  const otherResolution = resolution === 1000 ? 500 : 1000;
  const otherRun = runs[guiersIdentity(configuration, otherResolution, reference.hydroSha256, local?.sha)];
  const horizon = activeResult?.parameters.days;
  useEffect(() => {
    if (!playing || horizon === undefined || day >= horizon) return;
    const timer = setTimeout(() => {
      setDay(day + 1);
      if (day + 1 === horizon) setPlaying(false);
    }, 250);
    return () => clearTimeout(timer);
  }, [playing, horizon, day]);
  const hasSelection = selected?.identity === identity;
  useEffect(() => {
    if (!scientific || !profileSha || (!showParts && !showLinks && !hasSelection)) return;
    const abort = new AbortController();
    const query = new URLSearchParams({ configuration, resolution: String(resolution), sha: profileSha });
    void localGuiersJson(`graph?${query}`, abort.signal).then(parts => {
      if (!abort.signal.aborted) setGraph({ identity, parts });
    }).catch(cause => { if (!abort.signal.aborted) setError(errorText(cause)); });
    return () => abort.abort();
  }, [configuration, identity, profileSha, resolution, scientific, hasSelection, showLinks, showParts]);
  const parts = graph?.identity === identity ? graph.parts : undefined;
  const selectedCell = selected?.identity === identity ? grid.cells.find(c => c.id === selected.cellId) : undefined;
  const selectedParts = parts?.nodes.filter(part => part.cellId === selectedCell?.id);
  const byPart = new Map(showLinks && parts ? parts.nodes.map(node => [node.id, node.labelPoint]) : []);
  const frame = activeResult && resultAt(activeResult, grid, day);
  const summary = gridSummary(grid);
  const layers: AtlasMapLayers = {
    frame: hydro,
    water: activeFishing?.geometry ?? (configuration === 'E' && alternative ? alternative : hydro),
    alternate: showAlternate ? (activeFishing || configuration === 'E' ? hydro : alternative) : undefined,
    mask: scientific && showMask ? local?.profile?.mask : undefined,
    removed: showAlternate ? activeFishing?.removedGeometry ?? undefined : undefined,
    cut: showAlternate ? activeFishing?.boundsCutWgs84 : undefined,
    clipAreasToWater: Boolean(activeFishing),
    grid: showGrid ? grid.gridLines : undefined,
    density: frame,
    cells: scientific && (showGrid || selectedCell) ? grid.cells.map(cell => ({ id: cell.id, corners: cellCorners(grid, cell) })) : undefined,
    waterParts: scientific && showParts ? parts?.nodes : undefined,
    waterLinks: scientific && showLinks ? parts?.edges.map(edge => [byPart.get(edge.a)!, byPart.get(edge.b)!]) : undefined,
    areas: [
      ...(visibleThemes.includes('zoneExclusionPeche') ? (themes?.zoneExclusionPeche ?? []).map(f =>
        ({ id: f.id, geometry: f.geometry, kind: 'reserve' as const, label: 'Réserve candidate (à confirmer)' })) : []),
      ...(visibleThemes.includes('tipha_theoric') ? (themes?.tipha_theoric ?? []).map(f =>
        ({ id: f.id, geometry: f.geometry, kind: 'typha' as const, label: 'Typha théorique' })) : []),
    ],
    points: visibleThemes.includes('villages') ? (themes?.villages ?? []).map(f =>
      ({ id: f.id, coordinates: f.geometry.coordinates, outside: villageStatuses.get(f.id)?.insideWater === false,
        label: f.properties.name ?? 'Village sans nom renseigné' })) : [],
    villageNames: showVillageNames,
    legend: ['Eau', showAlternate && alternative && 'Tirets : contour de comparaison', showGrid && 'Quadrillage : cellules',
      showAlternate && activeFishing?.removedGeometry && 'Ocre : eau hors du périmètre étudié',
      showAlternate && Boolean(activeFishing?.boundsCutWgs84.length) && 'Rouge : coupure dans l’eau',
      activeFishing && themes?.villages && visibleThemes.includes('villages') && 'Cercle ouvert : village hors de l’eau',
      scientific && showLinks && parts && 'Segments : liens géométriques schématiques',
      frame && 'Bleu foncé : densité plus élevée', ...themeOptions.map(([key, label]) => themes?.[key] && visibleThemes.includes(key) && label)]
      .filter(Boolean).join(' · '),
  };

  async function readCandidate(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const version = ++readVersion.current;
    setPending(undefined);
    setProfileStatus('');
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
      const next = checkedResult(JSON.parse(await file.text()), identity, grid);
      acceptResult(next);
      setError('');
    } catch (cause) { setError(errorText(cause)); }
  }

  function acceptResult(next: GuiersLogisticResult) {
    const totals = totalsByDay(next);
    setRuns(previous => ({ ...previous, [next.identity]: { result: next, totals } }));
    setDay(next.parameters.days); setPlaying(false);
  }

  function resetSimulation(clearAll = false) {
    controller.current?.abort();
    setRuns(previous => clearAll ? {} : Object.fromEntries(Object.entries(previous).filter(([key]) => key !== identity)));
    setBusy(false); setDay(0); setPlaying(false); setError('');
  }

  function changeGrid(nextConfiguration: GuiersConfiguration, nextResolution: GuiersResolution) {
    controller.current?.abort();
    setBusy(false); setPlaying(false); setSelected(undefined); setError('');
    setDay(runs[guiersIdentity(nextConfiguration, nextResolution, reference.hydroSha256, local?.sha)]?.result.parameters.days ?? 0);
    setConfiguration(nextConfiguration); setResolution(nextResolution);
  }

  async function simulate() {
    if (busy || (localRunner && !profileSha)) return;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true); setError('');
    try {
      const next = profileSha ? checkedResult(await localGuiersJson('run',
        AbortSignal.any([abort.signal, AbortSignal.timeout(120000)]),
        { configuration, resolution, sha: profileSha, parameters }), identity, grid) :
        await runGuiersLogistic(reference.grids[resolution], identity, parameters, request => runSimulation(request, abort.signal), 1);
      if (!abort.signal.aborted) acceptResult(next);
    } catch (cause) { if (!abort.signal.aborted) setError(errorText(cause)); }
    finally { if (!abort.signal.aborted) setBusy(false); }
  }

  return <section className="geo-sig" aria-label="Référentiel SIG du lac">
    <div className="geo-sig-controls">
      <label>Configuration <select value={configuration} onChange={e => changeGrid(e.target.value as GuiersConfiguration, resolution)}>
        <option value="H">{labels.H}</option>
        <option value="E" disabled={!alternative}>{local?.profile?.synthetic ? 'E — contour alternatif synthétique' : labels.E}</option>
        <option value="H_PLUS" disabled={!guiersGrid(reference, 'H_PLUS', resolution, candidate)}>{labels.H_PLUS}</option>
        <option value="HP_PLUS" disabled={!fishing}>{labels.HP_PLUS}</option>
        {scientific && <option value="L_V_PLUS" disabled>Lv+ — validation requise</option>}
      </select></label>
      <label>Résolution <select value={resolution} onChange={e => changeGrid(configuration, Number(e.target.value) as GuiersResolution)}>
        {guiersResolutions.map(h => <option key={h} value={h}>{h === 1000 ? '1 km' : '500 m'}</option>)}
      </select></label>
      <label><input type="checkbox" checked={showGrid} onChange={e => setShowGrid(e.target.checked)}/> Grille</label>
      {(alternative || activeFishing?.removedGeometry) && <label><input type="checkbox" checked={showAlternate} onChange={e => setShowAlternate(e.target.checked)}/> Comparer les contours</label>}
    </div>
    {local?.profile?.synthetic && <p className="geo-privacy">Recette synthétique. Le fond HydroLAKES est réel et les couches complémentaires sont fictives.</p>}
    {profileStatus && <p role="status">{profileStatus}</p>}
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
      <label><input type="checkbox" checked={showVillageNames && visibleThemes.includes('villages')}
        disabled={!themes?.villages || !visibleThemes.includes('villages')}
        onChange={e => setShowVillageNames(e.target.checked)}/> Noms des villages</label>
    </fieldset>}
    {scientific && profileSha && <fieldset className="geo-sig-controls"><legend>Géométrie du domaine</legend>
      <label><input type="checkbox" checked={showMask} onChange={e => setShowMask(e.target.checked)}/> Masque du domaine</label>
      <label><input type="checkbox" checked={showParts} onChange={e => setShowParts(e.target.checked)}/> Sous-composantes aquatiques</label>
      <label><input type="checkbox" checked={showLinks} onChange={e => setShowLinks(e.target.checked)}/> Relations de voisinage</label>
    </fieldset>}
    <div className="geo-map-card"><GeoAtlasMap features={noFeatures} selected={selectedCell?.id}
      onSelect={cellId => setSelected({ identity, cellId })} layers={layers}/></div>
    {scientific && <div className="geo-details">
      <label>Cellule active <select value={selectedCell?.id ?? ''} onChange={e =>
        setSelected(e.target.value ? { identity, cellId: e.target.value } : undefined)}>
        <option value="">Choisir une cellule</option>
        {grid.cells.map(cell => <option key={cell.id}>{cell.id}</option>)}
      </select></label>
      {selectedCell && <section aria-label="Détails de la cellule">
        <p>{selectedCell.id} · {fmt.format(selectedCell.cellAreaM2)} m² au total · {fmt.format(selectedCell.waterAreaM2)} m² en eau
          {' '}({percentage(selectedCell.waterFraction)}).</p>
        <p>{selectedCell.waterComponentCount} sous-composante(s) aquatique(s) · Réserve candidate {percentage(selectedCell.candidateProtectedFraction)}
          {' '}· Typha théorique {percentage(selectedCell.theoreticalTyphaFraction)}.</p>
        {selectedParts ? <details><summary>Parties et connexions aquatiques ({selectedParts.reduce((sum, part) => sum + part.neighbors.length, 0)})</summary>
          <ul>{selectedParts.map(part => <li key={part.id}>{part.id} · {fmt.format(part.waterAreaM2)} m²
            {' '}· {part.neighbors.join(', ') || 'aucune connexion'}</li>)}</ul>
        </details> : <p>{profileSha ? 'Chargement des connexions par partie…' :
          `Voisinage historique des cellules : ${selectedCell.neighbors.join(', ') || 'aucune connexion dans ce graphe'}.`}</p>}
        {activeResult && frame && <p>Biomasse initiale {fmt.format(activeResult.cells.find(c => c.id === selectedCell.id)!.samples[0]!.value)} kg
          {' '}· Biomasse au jour {day} {fmt.format(frame.find(c => c.id === selectedCell.id)!.value)} kg.</p>}
      </section>}
    </div>}
    {enriched && themes?.villages && visibleThemes.includes('villages') && <details>
      <summary>Villages affichés</summary>
      <ul className="geo-sig-villages">{themes.villages.map(v => <li key={v.id}>{v.properties.name ?? 'Village sans nom renseigné'}
        {villageStatuses.get(v.id)?.insidePerimeterMask === false ? ' · hors du périmètre' :
          villageStatuses.get(v.id)?.insideWater === false && ' · hors de l’eau'}</li>)}</ul>
    </details>}
    {activeRun && activeResult && frame && <div>
      <label>Jour {day} <input aria-label="Jour de simulation" type="range" min="0" max={activeResult.parameters.days} value={day}
        onChange={e => { setPlaying(false); setDay(Number(e.target.value)); }}/></label>
      <button onClick={() => { if (playing) setPlaying(false); else { if (day >= activeResult.parameters.days) setDay(0); setPlaying(true); } }}>
        {playing ? 'Mettre en pause' : 'Animer la biomasse'}</button>
      <p role="status">Biomasse simulée {fmt.format(activeRun.totals[day]!)} kg au jour {day}.</p>
      {scientific && <><p>Biomasse initiale {fmt.format(activeRun.totals[0]!)} kg · finale {fmt.format(activeRun.totals.at(-1)!)} kg.</p>
        <Trajectory totals={activeRun.totals} day={day}/>
        {otherRun && <p>À {otherResolution} m, biomasse initiale {fmt.format(otherRun.totals[0]!)} kg · finale
          {' '}{fmt.format(otherRun.totals.at(-1)!)} kg au jour {otherRun.result.parameters.days}.
          {!parameterFields.every(({ key }) => activeResult.parameters[key] === otherRun.result.parameters[key]) &&
            ' Les deux calculs utilisent des paramètres différents.'}</p>}</>}
    </div>}
    {Object.keys(runs).length > 0 && !activeResult && <p role="status">Un résultat est disponible pour son référentiel et sa résolution d’origine.</p>}
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
        {local && <button onClick={() => { ++readVersion.current; changeGrid('H', resolution); setPending(undefined); setLocal(undefined); setGraph(undefined); resetSimulation(true); }}>Fermer les données locales</button>}
      </div>
      {pending && <article className="geo-import-preview">
        <h3>Aperçu avant activation locale</h3>
        <p>{Object.keys(pending.candidate.layers).map(key => `${key} (${pending.candidate.layers[key as keyof GuiersCandidate['layers']]?.length})`).join(' · ')}. Données candidates pour cette session.</p>
        {pending.candidate.fishingDomain && <p>{labels.HP_PLUS} · {gridSummary(pending.candidate.fishingDomain.grids[resolution]).area} km².</p>}
        {pending.candidate.comparison && <Comparison value={pending.candidate.comparison}/>}
        <button onClick={() => {
          let next = configuration;
          if (!local || !guiersGrid(reference, configuration, resolution, pending.candidate)) {
            next = pending.candidate.fishingDomain ? 'HP_PLUS' : pending.candidate.grids[resolution] ? 'H_PLUS' : 'E';
          }
          changeGrid('H', resolution);
          resetSimulation(true);
          setConfiguration(next);
          setLocal(pending);
          setPending(undefined);
        }}>Activer le référentiel candidat</button>
        <button onClick={() => setPending(undefined)}>Annuler l’activation</button>
      </article>}
      <fieldset className="geo-sig-controls geo-sig-parameters" disabled={busy || (localRunner && !profileSha)}>
        <legend>Croissance autonome par cellule</legend>
        {parameterFields.map(({ key, label, min, max, step }) => <label key={key}>{label}
          <input type="number" step={step} min={min} max={max} value={Number.isNaN(parameters[key]) ? '' : parameters[key]}
            onChange={e => setParameters(values => ({ ...values, [key]: e.target.valueAsNumber }))}/>
        </label>)}
      </fieldset>
      <div className="geo-actions">
        <button disabled={busy || (localRunner && !profileSha)} onClick={() => void simulate()}>{busy ? 'Simulation en cours…' : 'Simuler la croissance autonome'}</button>
        {(activeRun || busy) && <button onClick={() => resetSimulation()}>Réinitialiser la simulation</button>}
        <label>Ouvrir un résultat local<input type="file" accept=".json,application/json" aria-label="Ouvrir un résultat local" onChange={e => void readResult(e)}/></label>
      </div>
      {localRunner && !profileSha && <p>Ce référentiel importé manuellement utilise un résultat du runner natif chargé depuis un fichier.</p>}
    </div>}
    {error && <p className="error-banner" role="alert">{scientific ? error : 'L’opération n’a pas abouti.'}</p>}
  </section>;
}

const parameterFields: { key: keyof GuiersLogisticParams; label: string; min: number; max?: number; step: number | 'any' }[] = [
  { key: 'initialKgM2', label: 'Biomasse initiale (kg/m²)', min: 0, step: 'any' },
  { key: 'capacityKgM2', label: 'Capacité de charge (kg/m²)', min: 0, step: 'any' },
  { key: 'growthPerDay', label: 'Taux de croissance (par jour)', min: 0, step: 'any' },
  { key: 'days', label: 'Durée (jours)', min: 1, max: 365, step: 1 },
];

function percentage(value: number | null) {
  return value === null ? 'inconnue' : `${fmt.format(100 * value)} %`;
}

function Trajectory({ totals, day }: { totals: number[]; day: number }) {
  const min = Math.min(...totals), span = Math.max(...totals) - min || 1;
  const x = (i: number) => 6 + 308 * i / (totals.length - 1);
  const y = (total: number) => 60 - 48 * (total - min) / span;
  return <svg className="geo-sig-trajectory" viewBox="0 0 320 72" role="img" aria-label="Évolution de la biomasse totale par jour">
    <path d="M6 10 V64 H314" fill="none" stroke="#b5cbd2"/>
    <polyline points={totals.map((total, i) => `${x(i)},${y(total)}`).join(' ')} fill="none" stroke="currentColor" strokeWidth="2"/>
    <circle cx={x(day)} cy={y(totals[day]!)} r="4" fill="currentColor"/>
  </svg>;
}

function Comparison({ value }: { value: NonNullable<GuiersCandidate['comparison']> }) {
  return <p>Commun {fmt.format(value.intersectionKm2)} km² · H seul {fmt.format(value.hydroOnlyKm2)} km² · E seul {fmt.format(value.alternativeOnlyKm2)} km² · Jaccard {fmt.format(value.jaccard)}.</p>;
}
