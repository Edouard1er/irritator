'use client';
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type SetStateAction } from 'react';
import { Background, BackgroundVariant, Controls, MarkerType, MiniMap, ReactFlow, ReactFlowProvider, useReactFlow, type Connection, type Edge, type EdgeChange, type NodeChange } from '@xyflow/react';
import { Activity, ArrowRight, Check, ChevronDown, CircleHelp, FilePlus2, FolderOpen, Maximize, Network, Play, RefreshCw, Save, Settings2, X } from 'lucide-react';
import { validateEditorDocument } from '@/lib/modeling/model';
import { applyScopeView, coupledSpec, definitions, renameObservationPaths, rootScope, scopeCatalog, scopeView } from '@/lib/modeling/hierarchy';
import { HierarchyTools } from './hierarchy-tools';
import { inspectStructure, validateRequest, type RunRequest } from '@contracts';
import { ClientError, getCatalog, getHealth, runSimulation, errorText, type HttpResult } from '@/lib/api/client';
import { connectionError, defaultParameters, deserializeModel, edgeId, emptyModel, fingerprint, scientificFingerprint, handleId, nodeRowSpacing, removeComponents, renameComponent, serializeModel, toConnection, uniqueId, type Catalog, type ComponentSpec, type EditorState, type FlowConnection } from '@/lib/modeling/model';
import { downloadFile, loadWorkspace, saveWorkspace, legacyStorageKey, storageKey } from '@/lib/serialization/workspace';
import { ComponentLibrary } from '@/components/panels/component-library';
import { Inspector } from '@/components/panels/inspector';
import { NumberField } from '@/components/panels/number-field';
import { IrritatorNodeView, type IrritatorNode } from '@/components/nodes/irritator-node';
import { assertCanRemove, componentSpec, newWrapperExperiment, promoteToV3, renameExperimentPaths, updateExperiment, validateDependencies, wrapperPaletteSpec } from '@/lib/modeling/wrapper';
import { WrapperInspector } from '@/components/panels/wrapper-inspector';
import { ExperimentOverridesEditor } from '@/components/panels/experiment-overrides';
import { SimulationWorkspace } from '@/components/simulation/simulation-workspace';
import { LevelTwoJourney } from '@/components/workshop/level-two-journey';
import { TerritoryWorkspace } from '@/components/territory/territory-workspace';
import territorialModel from '../../../../examples/atelier-interventions-month-v3.json';

const nodeTypes = { irritator: IrritatorNodeView };
type Status = 'Prêt' | 'Validation' | 'Exécution' | 'Terminé' | 'Échec';
type EditorOptions = { level?: 1 | 2; active?: boolean };
export function ModelEditor(options: EditorOptions = {}) { return <ReactFlowProvider><Editor {...options}/></ReactFlowProvider>; }

function Editor({ level = 1, active = true }: EditorOptions) {
  const localKey = level === 1 ? storageKey : 'irritator.level2.workspace.v2';
  const [document, setDocument] = useState<EditorState>(() => level === 1 ? emptyModel() : deserializeModel(territorialModel));
  const [modelingView, setModelingView] = useState<'territory' | 'editor'>(level === 2 ? 'territory' : 'editor');
  const [territoryRevision, setTerritoryRevision] = useState(0);
  const [guidedScientific, setGuidedScientific] = useState(false);
  const scopeId = document.activeScope ?? rootScope;
  const state = useMemo(() => scopeView(document, scopeId), [document, scopeId]);
  const setState = useCallback((update: SetStateAction<EditorState>) => setDocument(previous => {
    const id = previous.activeScope ?? rootScope;
    const view = scopeView(previous, id);
    return applyScopeView(previous, id, typeof update === 'function' ? update(view) : update);
  }), []);
  const [loaded, setLoaded] = useState(false);
  const [workspace, setWorkspace] = useState<'modeling' | 'simulation'>('modeling');
  const [nativeCatalog, setCatalog] = useState<Catalog>();
  const [wrapperAvailable, setWrapperAvailable] = useState(false);
  const [catalogError, setCatalogError] = useState<string>();
  const catalog = useMemo(() => scopeCatalog(document.request, nativeCatalog, scopeId), [document.request.model.definitions, nativeCatalog, scopeId]);
  const [health, setHealth] = useState<'checking' | 'ready' | 'unavailable'>('checking');
  const [healthError, setHealthError] = useState<string>();
  const [selected, setSelected] = useState<string>();
  const [selectedEdge, setSelectedEdge] = useState<string>();
  const [nodeDimensions, setNodeDimensions] = useState<Record<string, { width: number; height: number }>>({});
  const [status, setStatus] = useState<Status>('Prêt');
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [saveStatus, setSaveStatus] = useState('Sauvegarde locale active');
  const [result, setResult] = useState<{ data: HttpResult; fingerprint: string; request: RunRequest; sessionId?:string }>();
  const [exported, setExported] = useState(() => fingerprint(document.request));
  const [showHelp, setShowHelp] = useState(false);
  const [showConnection, setShowConnection] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const running = useRef(false);
  const restorationFailed = useRef(false);
  const backendChecking = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const flow = useReactFlow<IrritatorNode>();
  const currentFingerprint = fingerprint(document.request);
  const dirty = currentFingerprint !== exported;
  const resultStale = !!result && (level === 2 ? scientificFingerprint(result.request) !== scientificFingerprint(document.request) : result.fingerprint !== currentFingerprint);
  const resultRequest = useMemo(() => result && level === 2 ? { ...result.request, fishingActivities: document.request.fishingActivities } : result?.request, [result, level, document.request.fishingActivities]);
  const busy = status === 'Validation' || status === 'Exécution';

  useEffect(() => {
    try {
      const stored = localStorage.getItem(localKey) ?? (level === 1 ? localStorage.getItem(legacyStorageKey) : null);
      if (stored) { const restored = loadWorkspace(stored); setDocument(restored); void flow.setViewport(scopeView(restored, restored.activeScope ?? rootScope).viewport); setNotice('Modèle restauré depuis ce navigateur.'); }
    } catch { restorationFailed.current = true; setNotice('La sauvegarde locale n’a pas pu être restaurée. Elle est conservée ; ouvrez un JSON ou créez un nouveau modèle pour reprendre la sauvegarde.'); }
    setLoaded(true);
  }, [flow, localKey, level]);
  useEffect(() => {
    if (!loaded || restorationFailed.current) return;
    const timer = setTimeout(() => {
      let snapshot: string;
      try { snapshot = saveWorkspace(document); }
      catch { setSaveStatus('Saisie invalide · dernière sauvegarde conservée'); return; }
      try { localStorage.setItem(localKey, snapshot); setSaveStatus('Sauvegardé dans ce navigateur'); }
      catch { setSaveStatus('Sauvegarde locale indisponible · exportez le modèle'); }
    }, 400);
    return () => clearTimeout(timer);
  }, [loaded, document, localKey]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const connectBackend = useCallback(async () => {
    // React StrictMode replays mount effects. Avoid four simultaneous --describe
    // processes against the Test 4 server's default two-process budget.
    if (backendChecking.current) return;
    backendChecking.current = true;
    setHealth('checking'); setHealthError(undefined); setCatalogError(undefined);
    try {
      const [h, c] = await Promise.allSettled([getHealth(), getCatalog()]);
      if (h.status === 'fulfilled') { setHealth('ready'); setWrapperAvailable(h.value.wrapperAvailable); }
      else { setHealth('unavailable'); setWrapperAvailable(false); setHealthError(errorText(h.reason)); }
      if (c.status === 'fulfilled') setCatalog(c.value);
      else setCatalogError(errorText(c.reason));
    } finally { backendChecking.current = false; }
  }, []);
  useEffect(() => { void connectBackend(); }, [connectBackend]);

  const navigate = (id: string, trail: string[]) => {
    const layout = id === rootScope ? document : document.scopes?.[id];
    setDocument(s => ({ ...s, activeScope: id, scopeTrail: trail }));
    setSelected(undefined); setSelectedEdge(undefined); setNodeDimensions({}); setFrom(''); setTo('');
    setTimeout(() => { if (layout) void flow.setViewport(layout.viewport); else void flow.fitView({ padding: 0.16, maxZoom: 1 }); }, 80);
  };
  const createDefinition = (id: string, name: string): string | undefined => {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || !name.trim()) return 'Identifiant et nom valides requis.';
    if (definitions(document.request).some(d => d.id === id)) return 'Cette définition existe déjà.';
    const request: RunRequest = { ...document.request, schemaVersion: document.request.schemaVersion === 3 ? 3 : 2, model: { ...document.request.model, definitions: [...definitions(document.request), { id, name, inputs: [], outputs: [], components: [], connections: [] }] } };
    try { validateEditorDocument(request); } catch (e) { return errorText(e); }
    setDocument(s => ({ ...s, request, activeScope: id, scopeTrail: [id] }));
    setSelected(undefined); setSelectedEdge(undefined); setNotice('Définition partagée créée. Ajoutez ses ports et ses enfants.');
    setTimeout(() => { void flow.fitView({ padding: 0.16, maxZoom: 1 }); }, 80);
    return undefined;
  };
  const structural = useMemo(() => {
    try { return inspectStructure(document.request); } catch { return []; }
  }, [document.request]);
  const localDiagnostics = structural.filter(d => scopeId === rootScope ? d.definition === null || d.path.includes('/@') || d.path.includes('/') : d.definition === scopeId);
  const nodeDiagnostic = (id: string) => localDiagnostics.find(d => scopeId === rootScope ? d.path.split('/')[0] === id : d.instance === id);
  const nodes: IrritatorNode[] = useMemo(() => state.request.model.components.map(component => ({
    id: component.id, type: 'irritator', position: state.positions[component.id] ?? { x: 0, y: 0 }, selected: selected === component.id, deletable: !component.id.startsWith('$'), measured: nodeDimensions[component.id],
    data: { structuralError: nodeDiagnostic(component.id)?.message, component, spec: componentSpec(component, catalog), observed: state.request.model.observations.some(o => o.component === component.id), prospectiveName: definitions(document.request).find(d => d.id === component.experiment?.definition)?.name, onOpen: component.experiment ? () => navigate(component.experiment!.definition, [...(document.scopeTrail ?? []), component.experiment!.definition]) : component.type.startsWith('coupled:') ? () => navigate(component.type.slice(8), [...(document.scopeTrail ?? []), component.type.slice(8)]) : undefined },
  })), [state.request.model.components, state.request.model.observations, state.positions, selected, catalog, nodeDimensions, document.scopeTrail, structural]);
  const edges: Edge[] = useMemo(() => state.request.model.connections.map(c => ({
    id: edgeId(c), source: c.from.component, target: c.to.component, sourceHandle: handleId('out', c.from.port), targetHandle: handleId('in', c.to.port),
    style: localDiagnostics.some(d => d.connection && edgeId(d.connection) === edgeId(c)) ? { stroke: '#c83939', strokeWidth: 3 } : undefined,
    type: 'smoothstep', selected: edgeId(c) === selectedEdge, markerEnd: { type: MarkerType.ArrowClosed, width: 15, height: 15 },
    ariaLabel: `${c.from.component} sortie ${c.from.port} vers ${c.to.component} entrée ${c.to.port}`,
  })), [state.request.model.connections, selectedEdge, structural, scopeId]);
  const editRequest = (update: (r: RunRequest) => RunRequest) => setState(s => ({ ...s, request: update(s.request) }));
  const addComponent = (spec: ComponentSpec, position?: { x: number; y: number }) => {
    if (state.request.model.components.length >= (state.request.limits?.maxComponents ?? 128)) { setError('LIMIT_EXCEEDED · Limite de composants atteinte.'); return; }
    const id = uniqueId(spec, state.request.model.components);
    const wrapper = spec.type === 'simulation_wrapper';
    if (wrapper && !wrapperAvailable) { setError('RUNNER_INCOMPATIBLE · Capacités v3 non confirmées.'); return; }
    if (wrapper && document.request.schemaVersion !== 3 && !window.confirm('Ajouter ce wrapper convertit explicitement le document en JSON v3. Tous les composants, définitions et connexions sont conservés. Continuer ?')) return;
    const count = state.request.model.components.length;
    const component = { id, type: spec.type, parameters: defaultParameters(spec), ...(wrapper ? { experiment: newWrapperExperiment(document.request, scopeId) } : {}) };
    const column = Math.floor(count / 3) * 285;
    const row = state.request.model.components.reduce((bottom, c) => {
      const placed = state.positions[c.id];
      return placed?.x === column ? Math.max(bottom, placed.y + Math.max(nodeRowSpacing(c, document.request), (nodeDimensions[c.id]?.height ?? 0) + 35)) : bottom;
    }, 0);
    const trial = applyScopeView(document, scopeId, { ...state, positions: { ...state.positions, [id]: position ?? { x: column, y: row } }, request: { ...state.request, model: { ...state.request.model, components: [...state.request.model.components, component] } } });
    if (wrapper) trial.request = promoteToV3(trial.request);
    try { if (wrapper || spec.type.startsWith('coupled:')) validateEditorDocument(trial.request); else validateDependencies(trial.request, true); } catch (e) { setError(errorText(e)); return; }
    setDocument(trial); setError(undefined);
    setSelected(id); setSelectedEdge(undefined); setNotice(undefined);
  };
  const onNodesChange = (changes: NodeChange<IrritatorNode>[]) => {
    const dimensions = changes.flatMap(c => c.type === 'dimensions' && c.dimensions ? [[c.id, c.dimensions] as const] : []);
    if (dimensions.length) setNodeDimensions(previous => {
      const modified = dimensions.filter(([id, size]) => previous[id]?.width !== size.width || previous[id]?.height !== size.height);
      return modified.length ? { ...previous, ...Object.fromEntries(modified) } : previous;
    });
    const removed = new Set(changes.filter(c => c.type === 'remove').filter(c => !c.id.startsWith('$')).map(c => c.id));
    if (removed.size) { try { assertCanRemove(document.request, scopeId, removed); setState(s => removeComponents(s, removed)); setSelected(undefined); } catch (e) { setError(errorText(e)); } }
    const moves = changes.flatMap(c => c.type === 'position' && c.position ? [[c.id, c.position] as const] : []);
    if (moves.length) setState(s => ({ ...s, positions: { ...s.positions, ...Object.fromEntries(moves) } }));
    const selection = changes.find(c => c.type === 'select' && c.selected);
    if (selection?.type === 'select') { setSelected(selection.id); setSelectedEdge(undefined); }
  };
  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    const removed = new Set(changes.filter(c => c.type === 'remove').map(c => c.id));
    if (removed.size) setState(s => ({ ...s, request: { ...s.request, model: { ...s.request.model, connections: s.request.model.connections.filter(c => !removed.has(edgeId(c))) } } }));
    const selection = changes.find(c => c.type === 'select' && c.selected);
    if (selection?.type === 'select') { setSelectedEdge(selection.id); setSelected(undefined); }
  }, []);
  const connect = (connection: FlowConnection) => {
    if (!catalog) return;
    const invalid = connectionError(connection, state.request, catalog);
    if (invalid) { setNotice(invalid); return; }
    editRequest(r => ({ ...r, model: { ...r.model, connections: [...r.model.connections, toConnection(connection)] } })); setNotice(undefined);
  };
  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    const type = e.dataTransfer.getData('application/irritator-component');
    const spec = type === 'simulation_wrapper' ? wrapperPaletteSpec : catalog?.components.find(c => c.type === type);
    if (spec) addComponent(spec, flow.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
  };
  const selectedComponent = state.request.model.components.find(c => c.id === selected && !c.id.startsWith('$'));
  const selectedSpec = selectedComponent ? componentSpec(selectedComponent, catalog) : undefined;
  const selectedObservation = state.request.model.observations.find(o => o.component === selected);
  const deleteEdge = () => { editRequest(r => ({ ...r, model: { ...r.model, connections: r.model.connections.filter(c => edgeId(c) !== selectedEdge) } })); setSelectedEdge(undefined); };
  const confirmReplace = () => !dirty || window.confirm('Ce modèle contient des modifications non exportées. Remplacer le modèle courant ?');
  const newModel = () => {
    if (!confirmReplace()) return;
    setWorkspace('modeling');
    setTerritoryRevision(v => v + 1);
    restorationFailed.current = false;
    const next = emptyModel(); setDocument(next); setExported(fingerprint(next.request)); setSelected(undefined); setSelectedEdge(undefined); setResult(undefined); setError(undefined); setStatus('Prêt'); setNotice(undefined); void flow.setViewport(next.viewport);
  };
  const openFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file || !confirmReplace()) return;
    try {
      if (file.size > 1048576) throw new Error('Fichier trop volumineux (maximum 1 Mio).');
      const next = deserializeModel(JSON.parse(await file.text()));
      setWorkspace('modeling');
      setTerritoryRevision(v => v + 1);
      restorationFailed.current = false;
      setDocument(next); setExported(fingerprint(next.request)); setSelected(undefined); setSelectedEdge(undefined); setResult(undefined); setError(undefined); setStatus('Prêt'); setNotice(`Modèle « ${next.request.model.id} » importé.`); void flow.setViewport(next.viewport);
      setTimeout(() => { void flow.fitView({ padding: 0.16, maxZoom: 1 }); }, 100);
    } catch (e) { setError(`Import impossible · ${errorText(e)}`); }
  };
  const exportModel = () => {
    try { const request = serializeModel(document); downloadFile(JSON.stringify(request, null, 2) + '\n', `${request.model.id}.json`); setExported(fingerprint(request)); setNotice(`JSON v${request.schemaVersion} exporté, prêt pour Fastify.`); }
    catch (e) { setError(errorText(e)); }
  };
  const run = async () => {
    if (running.current) return;
    running.current = true; setError(undefined); setStatus('Validation');
    try {
      const request = serializeModel(document);
      if (request.schemaVersion === 3 && !wrapperAvailable) throw new ClientError('RUNNER_INCOMPATIBLE', 'Reconnectez le moteur pour confirmer les capacités v3.');
      if (!request.model.observations.length) setNotice('Aucune observation sélectionnée : cette exécution ne produira pas de trajectoire.');
      setStatus('Exécution');
      if (level === 1) setWorkspace('simulation');
      const data = await runSimulation(request);
      setResult({ data, fingerprint: fingerprint(request), request }); setStatus('Terminé'); setHealth('ready');
    } catch (e) {
      setStatus('Échec'); setError(errorText(e));
      if (e instanceof ClientError && e.code === 'ENGINE_UNAVAILABLE') { setHealth('unavailable'); setHealthError(errorText(e)); }
    }
    finally { running.current = false; }
  };

  return <div className={`workbench ${workspace}-active${level === 2 && modelingView === 'territory' ? ' guided-level-two' : ''}${level === 2 && modelingView === 'territory' && !guidedScientific ? ' guided-fisher' : ''}${level === 2 && workspace === 'modeling' && modelingView === 'territory' ? ' territory-reading-active' : ''}`}>
    <header className="app-header"><a className="brand" href="/" onClick={e => e.preventDefault()} aria-label="Irritator Web"><span className="brand-mark"><Network size={21} /></span><strong>Irritator<span>Web</span></strong></a><span className="header-divider" /><label className="model-name"><span className="sr-only">Nom du modèle</span><input value={state.request.model.id} maxLength={64} onChange={e => { const id = e.target.value; setDocument(s => ({ ...s, request: { ...s.request, model: { ...s.request.model, id } } })); }} /><span className={`unsaved-dot ${dirty ? 'visible' : ''}`} title="Modifications non exportées" /></label>
      <nav className="file-actions" aria-label="Fichier"><button onClick={newModel} disabled={busy}><FilePlus2 size={15} />Nouveau</button><button onClick={() => fileInput.current?.click()} disabled={busy}><FolderOpen size={15} />Ouvrir</button><button onClick={exportModel}><Save size={15} />Enregistrer</button></nav>
      <div className="header-right"><button className={`engine-status ${health}`} title={healthError ?? 'Handshake du runner vérifié ; les tests numériques vérifient les calculs.'} onClick={() => void connectBackend()}><span />{health === 'ready' ? 'Moteur connecté' : health === 'checking' ? 'Vérification…' : 'Moteur indisponible'}<RefreshCw size={12} /></button>{level === 1 && <button className="primary run-header" onClick={() => void run()} disabled={busy || health !== 'ready'}><Play size={14} fill="currentColor" />{busy ? 'Exécution…' : 'Simuler'}</button>}<button className="icon-button" aria-label="Aide" onClick={() => setShowHelp(true)}><CircleHelp size={18} /></button></div>
    </header>
    {level === 1 && <nav className="workspace-navigation" aria-label="Espaces de travail"><button aria-current={workspace === 'modeling' ? 'page' : undefined} aria-controls={level === 1 ? 'modeling-workspace' : 'level2-modeling-workspace'} onClick={() => setWorkspace('modeling')}><Network size={17} />Modélisation</button><button aria-current={workspace === 'simulation' ? 'page' : undefined} aria-controls={level === 1 ? 'simulation-workspace' : 'level2-simulation-workspace'} onClick={() => setWorkspace('simulation')}><Activity size={17} />Simulation</button><span>Construire le modèle · explorer ses résultats</span></nav>}
    <input type="file" ref={fileInput} accept=".json,application/json" className="sr-only" aria-label="Ouvrir un modèle JSON" onChange={e => void openFile(e)} />
    <div id={level === 1 ? 'modeling-workspace' : 'level2-modeling-workspace'} className="modeling-workspace" hidden={workspace !== 'modeling'}>
    {level === 2 && <>
      <nav className="territory-view-navigation" aria-label="Vues de modélisation du niveau 2"><button aria-pressed={modelingView === 'territory'} onClick={() => setModelingView('territory')}>Territoire</button><button aria-pressed={modelingView === 'editor'} onClick={() => setModelingView('editor')}>Éditeur scientifique</button></nav>
      <div hidden={modelingView !== 'territory'}><LevelTwoJourney active={active && modelingView === 'territory'} stale={resultStale} request={document.request} result={result?.data} resultRequest={result?.request} busy={busy} error={error} onRun={() => void run()} onAudience={setGuidedScientific}
        territory={(journeyStep, scientific, next, showResults, atlas) => <TerritoryWorkspace key={territoryRevision} atlasController={atlas} journeyStep={journeyStep} journeyScientific={scientific} request={document.request} result={showResults ? result?.data : undefined} resultRequest={showResults ? result?.request : undefined} busy={busy} documentError={error} onApply={request => { setDocument(s => ({ ...s, request })); setError(undefined); }} onSimulation={next}/>}
        simulation={(journeyActive, guided) => <SimulationWorkspace guided={guided} preferenceScope={level === 2 ? 'level2' : undefined} request={resultRequest} result={result?.data} sessionId={result?.sessionId} onIntervention={(request,data)=>{if (level === 2) request = { ...request, fishingActivities: document.request.fishingActivities };setDocument(s=>({...s,request}));setResult(old=>({data,request,fingerprint:fingerprint(request),sessionId:old?.sessionId??old?.data.runId??data.runId}));setStatus('Terminé');}} stale={resultStale} status={status} error={error} active={active && modelingView === 'territory' && journeyActive} />}/></div>
    </>}
    <div className="scientific-editor-content" hidden={level === 2 && modelingView !== 'editor'}>
    <div className="model-toolbar"><div><span className="active-view"><Network size={14} />Éditeur de modèle</span><span className="toolbar-subtitle">{document.request.schemaVersion >= 2 ? 'Hiérarchie DEVS / QSS' : 'Graphe atomique · DEVS / QSS'}</span></div><div><button onClick={() => { try { validateRequest(document.request); setError(undefined); setNotice('Validation structurelle réussie.'); } catch (e) { setError(errorText(e)); } }}>Valider le modèle</button><span>{nodes.length} composants</span><span className="separator">/</span><span>{edges.length} connexions</span><button className="text-button" onClick={() => setShowConnection(v => !v)} aria-expanded={showConnection}><ArrowRight size={14} />Relier des ports</button><button className="icon-button" aria-label="Ajuster la vue" onClick={() => void flow.fitView({ padding: 0.16, maxZoom: 1 })}><Maximize size={15} /></button></div></div>
    {document.request.schemaVersion >= 2 && <HierarchyTools request={document.request} active={scopeId} trail={document.scopeTrail ?? []} onNavigate={navigate} onRequest={request => setDocument(s => ({ ...s, request }))} onNotice={setNotice} />}
    {showConnection && <form className="connection-form" onSubmit={e => { e.preventDefault(); const [source, sourceHandle] = from.split('|'), [target, targetHandle] = to.split('|'); connect({ source: source ?? null, target: target ?? null, sourceHandle, targetHandle }); }}>
      <label>Sortie<select aria-label="Port de sortie" value={from} onChange={e => setFrom(e.target.value)}><option value="">Choisir…</option>{state.request.model.components.flatMap(c => componentSpec(c, catalog)?.outputs.map(p => <option key={`${c.id}-${p.port}`} value={`${c.id}|${handleId('out', p.port)}`}>{c.id} · {p.name} [{p.port}]</option>) ?? [])}</select></label><ArrowRight size={16} /><label>Entrée<select aria-label="Port d’entrée" value={to} onChange={e => setTo(e.target.value)}><option value="">Choisir…</option>{state.request.model.components.flatMap(c => componentSpec(c, catalog)?.inputs.map(p => <option key={`${c.id}-${p.port}`} value={`${c.id}|${handleId('in', p.port)}`}>{c.id} · {p.name} [{p.port}]</option>) ?? [])}</select></label><button type="submit" disabled={!from || !to}>Créer la connexion</button><button type="button" className="icon-button" aria-label="Fermer les connexions" onClick={() => setShowConnection(false)}><X size={16} /></button>
    </form>}
    {notice && <div className="notice" role="status">{notice}<button aria-label="Fermer le message" onClick={() => setNotice(undefined)}><X size={13} /></button></div>}
    {healthError && <div className="error-banner" role="alert">{healthError} · L’édition reste disponible.</div>}
    {structural.length > 0 && <div className="error-banner" role="alert" data-testid="structural-diagnostics">
      {structural.map(d => <div key={d.path+d.code}><strong>{d.code}</strong> · {d.path} · Définition : {d.definition ?? 'racine'} · {d.message} · Attendu : {d.expected}
        <button onClick={() => { if (d.definition) navigate(d.definition, [d.definition]); setSelected(d.instance); setSelectedEdge(undefined); }}>Voir le composant</button>
      </div>)}
    </div>}
    <div className="workspace">
      <ComponentLibrary catalog={nativeCatalog} wrapperAvailable={wrapperAvailable} error={catalogError} definitions={definitions(document.request)} onCreate={createDefinition} onOpen={id => navigate(id, [id])} onInstance={id => { const d = definitions(document.request).find(d => d.id === id); if (d) addComponent(coupledSpec(d)); }} onRetry={() => void connectBackend()} onAdd={addComponent} />
      <main className="canvas" aria-label="Éditeur graphique" onDrop={handleDrop} onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}>
        <ReactFlow<IrritatorNode> nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
          onBeforeDelete={async ({ nodes }) => { if (!active || workspace !== 'modeling' || (level === 2 && modelingView !== 'editor')) return false; try { assertCanRemove(document.request, scopeId, new Set(nodes.map(n => n.id))); return true; } catch (e) { setError(errorText(e)); return false; } }}
          onConnect={(c: Connection) => connect(c)} isValidConnection={c => !!catalog && !connectionError(c, state.request, catalog)}
          onNodeClick={(_, node) => { setSelected(node.id); setSelectedEdge(undefined); }} onEdgeClick={(_, edge) => { setSelectedEdge(edge.id); setSelected(undefined); }} onPaneClick={() => { setSelected(undefined); setSelectedEdge(undefined); }}
          onMoveEnd={(_, viewport) => setState(s => ({ ...s, viewport }))} defaultViewport={state.viewport} minZoom={0.05} maxZoom={2}
          deleteKeyCode={active && workspace === 'modeling' && (level === 1 || modelingView === 'editor') ? ['Backspace', 'Delete'] : null} selectionOnDrag connectOnClick connectionRadius={28} snapToGrid snapGrid={[10, 10]} proOptions={{ hideAttribution: false }}
          aria-label="Graphe Irritator" defaultEdgeOptions={{ interactionWidth: 24 }}>
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#dce2e7" />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable nodeColor="#b6cdca" maskColor="rgba(247,249,250,.7)" />
        </ReactFlow>
        {!nodes.length && <div className="canvas-empty"><span className="canvas-empty-symbol"><Network size={32} /></span><span className="eyebrow">VOTRE ESPACE DE MODÉLISATION</span><p>Ajoutez des composants, reliez leurs ports<br />et explorez la dynamique de votre modèle.</p><span className="empty-hint">← Choisissez un composant dans la bibliothèque</span></div>}
        <span className="canvas-label">{state.request.model.id} <ChevronDown size={11} /></span>
      </main>
      {selectedComponent?.experiment ? <WrapperInspector key={`${scopeId}-${selectedComponent.id}`} component={selectedComponent} request={document.request} spec={selectedSpec!}
        onExperiment={(experiment, identity) => { try { const request = updateExperiment(document.request, scopeId, selectedComponent.id, experiment, identity); setDocument(s => ({ ...s, request })); setFrom(''); setTo(''); setError(undefined); } catch (e) { return errorText(e); } }}
        onOpen={id => navigate(id, [...(document.scopeTrail ?? []), id])}
        onRename={next => { try { const renamed = applyScopeView(document, scopeId, renameComponent(state, selectedComponent.id, next)); renamed.request = renameExperimentPaths(document.request, renamed.request, scopeId, selectedComponent.id, next); setDocument(renamed); setSelected(next); } catch (e) { return errorText(e); } }}
        onDelete={() => { try { assertCanRemove(document.request, scopeId, new Set([selectedComponent.id])); setState(s => removeComponents(s, new Set([selectedComponent.id]))); setSelected(undefined); } catch (e) { setError(errorText(e)); } }} /> : <Inspector canObserve={scopeId === rootScope && !selectedComponent?.type.startsWith('coupled:')} onOpen={selectedComponent?.type.startsWith('coupled:') ? () => navigate(selectedComponent.type.slice(8), [...(document.scopeTrail ?? []), selectedComponent.type.slice(8)]) : undefined} component={selectedComponent} spec={selectedSpec} observation={selectedObservation} selectedEdge={selectedEdge} onDeleteEdge={deleteEdge}
        onParameter={(key, value) => editRequest(r => ({ ...r, model: { ...r.model, components: r.model.components.map(c => c.id === selected ? { ...c, parameters: { ...c.parameters, [key]: value } } : c) } }))}
        onRename={next => { if (!selected) return; try { const renamed = applyScopeView(document, scopeId, renameComponent(state, selected, next)); renamed.request = renameExperimentPaths(document.request, renameObservationPaths(document.request, renamed.request, scopeId, selected, next), scopeId, selected, next); setDocument(renamed); setSelected(next); } catch (e) { return errorText(e); } }}
        onObserve={(enabled, interval) => editRequest(r => ({ ...r, model: { ...r.model, observations: [...r.model.observations.filter(o => o.component !== selected), ...(enabled && selected ? [{ ...r.model.observations.find(o => o.component === selected), component: selected, samplingInterval: interval }] : [])] } }))}
        onDelete={() => { if (selected) { try { assertCanRemove(document.request, scopeId, new Set([selected])); setState(s => removeComponents(s, new Set([selected]))); setSelected(undefined); } catch (e) { setError(errorText(e)); } } }}
        extra={selectedComponent?.type.startsWith('coupled:') && document.request.schemaVersion === 3 ? <ExperimentOverridesEditor component={selectedComponent} request={document.request} onChange={experimentOverrides => editRequest(r => ({ ...r, model: { ...r.model, components: r.model.components.map(c => { if (c.id !== selected) return c; const { experimentOverrides: old, ...rest } = c; return experimentOverrides.length ? { ...rest, experimentOverrides } : rest; }) } }))} /> : undefined} />}
    </div>
    <div className="simulation-bar"><div className="simulation-label"><Settings2 size={16} /><strong>Simulation</strong><span className="muted small">Temps simulé</span></div><NumberField label="Début" value={state.request.simulation.start} minimum={-1e9} maximum={1e9} onChange={start => setDocument(s => ({ ...s, request: { ...s.request, simulation: { ...s.request.simulation, start } } }))} /><ArrowRight size={14} className="muted" /><NumberField label="Fin" value={state.request.simulation.end} minimum={-1e9} maximum={1e9} onChange={end => setDocument(s => ({ ...s, request: { ...s.request, simulation: { ...s.request.simulation, end } } }))} /><span className="simulation-observations"><Activity size={14} />{document.request.model.observations.length} observé{document.request.model.observations.length > 1 ? 's' : ''}</span><div className={`simulation-status ${status === 'Échec' ? 'failed' : ''}`} role="status">{status === 'Terminé' && <Check size={14} />}{status}</div><button className="primary" onClick={() => void run()} disabled={busy || health !== 'ready'}><Play size={14} fill="currentColor" />{busy ? 'Calcul en cours…' : 'Exécuter la simulation'}</button></div>
    </div>
    </div>
    {level === 1 && <div id={level === 1 ? 'simulation-workspace' : 'level2-simulation-workspace'} className="simulation-container" hidden={workspace !== 'simulation'}><SimulationWorkspace  request={resultRequest} result={result?.data} sessionId={result?.sessionId} onIntervention={(request,data)=>{setDocument(s=>({...s,request}));setResult(old=>({data,request,fingerprint:fingerprint(request),sessionId:old?.sessionId??old?.data.runId??data.runId}));setStatus('Terminé');}} stale={resultStale} status={status} error={error} active={active && workspace === 'simulation'} /></div>}
    <footer className="app-footer"><span><span className="footer-dot" />{saveStatus}</span><span>libirritator {catalog?.engineVersion ?? '—'}<span className="separator">·</span>Calcul natif C++<span className="separator">·</span>Contrat JSON v{document.request.schemaVersion}</span></footer>
    {showHelp && <div className="modal-backdrop" onClick={() => setShowHelp(false)}><div className="help-dialog" role="dialog" aria-modal="true" aria-label="Utiliser l’atelier" onClick={e => e.stopPropagation()}><button autoFocus className="icon-button modal-close" aria-label="Fermer l’aide" onClick={() => setShowHelp(false)}><X size={18} /></button><h2>Construire. Relier. Simuler.</h2><ol><li>Ajoutez un composant depuis la bibliothèque.</li><li>Sélectionnez-le pour régler ses paramètres et activer son observation.</li><li>Cliquez une sortie puis une entrée, ou utilisez « Relier des ports ».</li><li>Réglez les bornes temporelles puis exécutez.</li><li>Explorez les trajectoires, les points exacts et les détails du calcul.</li></ol><p>Suppr / Retour arrière supprime la sélection. Déplacez les nœuds et utilisez la molette pour zoomer. Les boutons du canevas ajustent la vue.</p><p>Enregistrer exporte le JSON scientifique v1, v2 ou v3 selon le modèle. La disposition est conservée séparément dans ce navigateur. Ouvrir accepte notamment <code>web/examples/sum3.json</code>.</p><p className="muted small">Les événements à la borne finale sont exclus. Le moteur peut publier un état terminal lors de la fermeture des observations.</p><button onClick={() => setShowHelp(false)}>Fermer l’aide</button></div></div>}
  </div>;
}
