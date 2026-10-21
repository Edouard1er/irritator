'use client';
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { Background, BackgroundVariant, Controls, MarkerType, MiniMap, ReactFlow, ReactFlowProvider, useReactFlow, type Connection, type Edge, type EdgeChange, type NodeChange } from '@xyflow/react';
import { Activity, ArrowRight, Check, ChevronDown, CircleHelp, FilePlus2, FolderOpen, Maximize, Network, Play, RefreshCw, Save, Settings2, X } from 'lucide-react';
import type { RunRequest } from '@contracts';
import { ClientError, getCatalog, getHealth, runSimulation, errorText, type HttpResult } from '@/lib/api/client';
import { connectionError, defaultParameters, deserializeModel, edgeId, emptyModel, fingerprint, handleId, removeComponents, renameComponent, serializeModel, toConnection, uniqueId, type Catalog, type ComponentSpec, type EditorState, type FlowConnection } from '@/lib/modeling/model';
import { downloadFile, loadWorkspace, saveWorkspace, storageKey } from '@/lib/serialization/workspace';
import { ComponentLibrary } from '@/components/panels/component-library';
import { Inspector } from '@/components/panels/inspector';
import { NumberField } from '@/components/panels/number-field';
import { ResultsPanel } from '@/components/panels/results-panel';
import { IrritatorNodeView, type IrritatorNode } from '@/components/nodes/irritator-node';

const nodeTypes = { irritator: IrritatorNodeView };
type Status = 'Prêt' | 'Validation' | 'Exécution' | 'Terminé' | 'Échec';
export function ModelEditor() { return <ReactFlowProvider><Editor /></ReactFlowProvider>; }

function Editor() {
  const [state, setState] = useState<EditorState>(emptyModel);
  const [loaded, setLoaded] = useState(false);
  const [catalog, setCatalog] = useState<Catalog>();
  const [catalogError, setCatalogError] = useState<string>();
  const [health, setHealth] = useState<'checking' | 'ready' | 'unavailable'>('checking');
  const [healthError, setHealthError] = useState<string>();
  const [selected, setSelected] = useState<string>();
  const [selectedEdge, setSelectedEdge] = useState<string>();
  const [nodeDimensions, setNodeDimensions] = useState<Record<string, { width: number; height: number }>>({});
  const [status, setStatus] = useState<Status>('Prêt');
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [saveStatus, setSaveStatus] = useState('Sauvegarde locale active');
  const [result, setResult] = useState<{ data: HttpResult; fingerprint: string }>();
  const [exported, setExported] = useState(() => fingerprint(emptyModel().request));
  const [showHelp, setShowHelp] = useState(false);
  const [showConnection, setShowConnection] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const running = useRef(false);
  const backendChecking = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const flow = useReactFlow<IrritatorNode>();
  const currentFingerprint = fingerprint(state.request);
  const dirty = currentFingerprint !== exported;
  const busy = status === 'Validation' || status === 'Exécution';

  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) { const restored = loadWorkspace(stored); setState(restored); void flow.setViewport(restored.viewport); setNotice('Modèle restauré depuis ce navigateur.'); }
    } catch { setNotice('La sauvegarde locale n’a pas pu être restaurée. Vous pouvez ouvrir un fichier JSON.'); }
    setLoaded(true);
  }, [flow]);
  useEffect(() => {
    if (!loaded) return;
    const timer = setTimeout(() => {
      let snapshot: string;
      try { snapshot = saveWorkspace(state); }
      catch { setSaveStatus('Saisie invalide · dernière sauvegarde conservée'); return; }
      try { localStorage.setItem(storageKey, snapshot); setSaveStatus('Sauvegardé dans ce navigateur'); }
      catch { setSaveStatus('Sauvegarde locale indisponible · exportez le modèle'); }
    }, 400);
    return () => clearTimeout(timer);
  }, [loaded, state]);
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
      if (h.status === 'fulfilled') setHealth('ready');
      else { setHealth('unavailable'); setHealthError(errorText(h.reason)); }
      if (c.status === 'fulfilled') setCatalog(c.value);
      else setCatalogError(errorText(c.reason));
    } finally { backendChecking.current = false; }
  }, []);
  useEffect(() => { void connectBackend(); }, [connectBackend]);

  const nodes: IrritatorNode[] = useMemo(() => state.request.model.components.map(component => ({
    id: component.id, type: 'irritator', position: state.positions[component.id] ?? { x: 0, y: 0 }, selected: selected === component.id, measured: nodeDimensions[component.id],
    data: { component, spec: catalog?.components.find(c => c.type === component.type), observed: state.request.model.observations.some(o => o.component === component.id) },
  })), [state.request.model.components, state.request.model.observations, state.positions, selected, catalog, nodeDimensions]);
  const edges: Edge[] = useMemo(() => state.request.model.connections.map(c => ({
    id: edgeId(c), source: c.from.component, target: c.to.component, sourceHandle: handleId('out', c.from.port), targetHandle: handleId('in', c.to.port),
    type: 'smoothstep', selected: edgeId(c) === selectedEdge, markerEnd: { type: MarkerType.ArrowClosed, width: 15, height: 15 },
    ariaLabel: `${c.from.component} sortie ${c.from.port} vers ${c.to.component} entrée ${c.to.port}`,
  })), [state.request.model.connections, selectedEdge]);
  const editRequest = (update: (r: RunRequest) => RunRequest) => setState(s => ({ ...s, request: update(s.request) }));
  const addComponent = (spec: ComponentSpec, position?: { x: number; y: number }) => {
    if (state.request.model.components.length >= (state.request.limits?.maxComponents ?? 128)) { setError('LIMIT_EXCEEDED · Limite de composants atteinte.'); return; }
    const id = uniqueId(spec, state.request.model.components);
    const count = state.request.model.components.length;
    setState(s => ({ ...s, positions: { ...s.positions, [id]: position ?? { x: Math.floor(count / 3) * 285, y: (count % 3) * 165 } }, request: { ...s.request, model: { ...s.request.model, components: [...s.request.model.components, { id, type: spec.type, parameters: defaultParameters(spec) }] } } }));
    setSelected(id); setSelectedEdge(undefined); setNotice(undefined);
  };
  const onNodesChange = useCallback((changes: NodeChange<IrritatorNode>[]) => {
    const dimensions = changes.flatMap(c => c.type === 'dimensions' && c.dimensions ? [[c.id, c.dimensions] as const] : []);
    if (dimensions.length) setNodeDimensions(previous => {
      const modified = dimensions.filter(([id, size]) => previous[id]?.width !== size.width || previous[id]?.height !== size.height);
      return modified.length ? { ...previous, ...Object.fromEntries(modified) } : previous;
    });
    const removed = new Set(changes.filter(c => c.type === 'remove').map(c => c.id));
    if (removed.size) { setState(s => removeComponents(s, removed)); setSelected(undefined); }
    const moves = changes.flatMap(c => c.type === 'position' && c.position ? [[c.id, c.position] as const] : []);
    if (moves.length) setState(s => ({ ...s, positions: { ...s.positions, ...Object.fromEntries(moves) } }));
    const selection = changes.find(c => c.type === 'select' && c.selected);
    if (selection?.type === 'select') { setSelected(selection.id); setSelectedEdge(undefined); }
  }, []);
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
    const spec = catalog?.components.find(c => c.type === e.dataTransfer.getData('application/irritator-component'));
    if (spec) addComponent(spec, flow.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
  };
  const selectedComponent = state.request.model.components.find(c => c.id === selected);
  const selectedSpec = catalog?.components.find(c => c.type === selectedComponent?.type);
  const selectedObservation = state.request.model.observations.find(o => o.component === selected);
  const deleteEdge = () => { editRequest(r => ({ ...r, model: { ...r.model, connections: r.model.connections.filter(c => edgeId(c) !== selectedEdge) } })); setSelectedEdge(undefined); };
  const confirmReplace = () => !dirty || window.confirm('Ce modèle contient des modifications non exportées. Remplacer le modèle courant ?');
  const newModel = () => {
    if (!confirmReplace()) return;
    const next = emptyModel(); setState(next); setExported(fingerprint(next.request)); setSelected(undefined); setSelectedEdge(undefined); setResult(undefined); setError(undefined); setStatus('Prêt'); setNotice(undefined); void flow.setViewport(next.viewport);
  };
  const openFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file || !confirmReplace()) return;
    try {
      if (file.size > 1048576) throw new Error('Fichier trop volumineux (maximum 1 Mio).');
      const next = deserializeModel(JSON.parse(await file.text()));
      setState(next); setExported(fingerprint(next.request)); setSelected(undefined); setSelectedEdge(undefined); setResult(undefined); setError(undefined); setStatus('Prêt'); setNotice(`Modèle « ${next.request.model.id} » importé.`); void flow.setViewport(next.viewport);
      setTimeout(() => { void flow.fitView({ padding: 0.16, maxZoom: 1 }); }, 100);
    } catch (e) { setError(`Import impossible · ${errorText(e)}`); }
  };
  const exportModel = () => {
    try { const request = serializeModel(state); downloadFile(JSON.stringify(request, null, 2) + '\n', `${request.model.id}.json`); setExported(fingerprint(request)); setNotice('JSON v1 exporté, prêt pour Fastify.'); }
    catch (e) { setError(errorText(e)); }
  };
  const run = async () => {
    if (running.current) return;
    running.current = true; setError(undefined); setStatus('Validation');
    try {
      const request = serializeModel(state);
      if (!request.model.observations.length) setNotice('Aucune observation sélectionnée : cette exécution ne produira pas de trajectoire.');
      setStatus('Exécution');
      const data = await runSimulation(request);
      setResult({ data, fingerprint: fingerprint(request) }); setStatus('Terminé'); setHealth('ready');
    } catch (e) {
      setStatus('Échec'); setError(errorText(e));
      if (e instanceof ClientError && e.code === 'ENGINE_UNAVAILABLE') { setHealth('unavailable'); setHealthError(errorText(e)); }
    }
    finally { running.current = false; }
  };

  return <div className="workbench">
    <header className="app-header"><a className="brand" href="/" onClick={e => e.preventDefault()} aria-label="Irritator Web"><span className="brand-mark"><Network size={21} /></span><strong>Irritator<span>Web</span></strong></a><span className="header-divider" /><label className="model-name"><span className="sr-only">Nom du modèle</span><input value={state.request.model.id} maxLength={64} onChange={e => editRequest(r => ({ ...r, model: { ...r.model, id: e.target.value } }))} /><span className={`unsaved-dot ${dirty ? 'visible' : ''}`} title="Modifications non exportées" /></label>
      <nav className="file-actions" aria-label="Fichier"><button onClick={newModel} disabled={busy}><FilePlus2 size={15} />Nouveau</button><button onClick={() => fileInput.current?.click()} disabled={busy}><FolderOpen size={15} />Ouvrir</button><button onClick={exportModel}><Save size={15} />Enregistrer</button></nav>
      <div className="header-right"><button className={`engine-status ${health}`} title={healthError ?? 'Handshake du runner vérifié ; les tests numériques vérifient les calculs.'} onClick={() => void connectBackend()}><span />{health === 'ready' ? 'Moteur connecté' : health === 'checking' ? 'Vérification…' : 'Moteur indisponible'}<RefreshCw size={12} /></button><button className="primary run-header" onClick={() => void run()} disabled={busy || health !== 'ready'}><Play size={14} fill="currentColor" />{busy ? 'Exécution…' : 'Simuler'}</button><button className="icon-button" aria-label="Aide" onClick={() => setShowHelp(true)}><CircleHelp size={18} /></button></div>
    </header>
    <input type="file" ref={fileInput} accept=".json,application/json" className="sr-only" aria-label="Ouvrir un modèle JSON" onChange={e => void openFile(e)} />
    <div className="model-toolbar"><div><span className="active-view"><Network size={14} />Éditeur de modèle</span><span className="toolbar-subtitle">Graphe atomique · DEVS / QSS</span></div><div><span>{nodes.length} composants</span><span className="separator">/</span><span>{edges.length} connexions</span><button className="text-button" onClick={() => setShowConnection(v => !v)} aria-expanded={showConnection}><ArrowRight size={14} />Relier des ports</button><button className="icon-button" aria-label="Ajuster la vue" onClick={() => void flow.fitView({ padding: 0.16, maxZoom: 1 })}><Maximize size={15} /></button></div></div>
    {showConnection && <form className="connection-form" onSubmit={e => { e.preventDefault(); const [source, sourceHandle] = from.split('|'), [target, targetHandle] = to.split('|'); connect({ source: source ?? null, target: target ?? null, sourceHandle, targetHandle }); }}>
      <label>Sortie<select aria-label="Port de sortie" value={from} onChange={e => setFrom(e.target.value)}><option value="">Choisir…</option>{state.request.model.components.flatMap(c => catalog?.components.find(s => s.type === c.type)?.outputs.map(p => <option key={`${c.id}-${p.port}`} value={`${c.id}|${handleId('out', p.port)}`}>{c.id} · {p.name} [{p.port}]</option>) ?? [])}</select></label><ArrowRight size={16} /><label>Entrée<select aria-label="Port d’entrée" value={to} onChange={e => setTo(e.target.value)}><option value="">Choisir…</option>{state.request.model.components.flatMap(c => catalog?.components.find(s => s.type === c.type)?.inputs.map(p => <option key={`${c.id}-${p.port}`} value={`${c.id}|${handleId('in', p.port)}`}>{c.id} · {p.name} [{p.port}]</option>) ?? [])}</select></label><button type="submit" disabled={!from || !to}>Créer la connexion</button><button type="button" className="icon-button" aria-label="Fermer les connexions" onClick={() => setShowConnection(false)}><X size={16} /></button>
    </form>}
    {notice && <div className="notice" role="status">{notice}<button aria-label="Fermer le message" onClick={() => setNotice(undefined)}><X size={13} /></button></div>}
    {healthError && <div className="error-banner" role="alert">{healthError} · L’édition reste disponible.</div>}
    <div className="workspace">
      <ComponentLibrary catalog={catalog} error={catalogError} onRetry={() => void connectBackend()} onAdd={addComponent} />
      <main className="canvas" aria-label="Éditeur graphique" onDrop={handleDrop} onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}>
        <ReactFlow<IrritatorNode> nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
          onConnect={(c: Connection) => connect(c)} isValidConnection={c => !!catalog && !connectionError(c, state.request, catalog)}
          onNodeClick={(_, node) => { setSelected(node.id); setSelectedEdge(undefined); }} onEdgeClick={(_, edge) => { setSelectedEdge(edge.id); setSelected(undefined); }} onPaneClick={() => { setSelected(undefined); setSelectedEdge(undefined); }}
          onMoveEnd={(_, viewport) => setState(s => ({ ...s, viewport }))} defaultViewport={state.viewport} minZoom={0.2} maxZoom={2}
          deleteKeyCode={['Backspace', 'Delete']} selectionOnDrag connectOnClick connectionRadius={28} snapToGrid snapGrid={[10, 10]} proOptions={{ hideAttribution: false }}
          aria-label="Graphe Irritator" defaultEdgeOptions={{ interactionWidth: 24 }}>
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#dce2e7" />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable nodeColor="#b6cdca" maskColor="rgba(247,249,250,.7)" />
        </ReactFlow>
        {!nodes.length && <div className="canvas-empty"><span className="canvas-empty-symbol"><Network size={32} /></span><span className="eyebrow">VOTRE ESPACE DE MODÉLISATION</span><h1>De l’idée à la simulation.</h1><p>Ajoutez des composants, reliez leurs ports<br />et explorez la dynamique de votre modèle.</p><span className="empty-hint">← Choisissez un composant dans la bibliothèque</span></div>}
        <span className="canvas-label">{state.request.model.id} <ChevronDown size={11} /></span>
      </main>
      <Inspector component={selectedComponent} spec={selectedSpec} observation={selectedObservation} selectedEdge={selectedEdge} onDeleteEdge={deleteEdge}
        onParameter={(key, value) => editRequest(r => ({ ...r, model: { ...r.model, components: r.model.components.map(c => c.id === selected ? { ...c, parameters: { ...c.parameters, [key]: value } } : c) } }))}
        onRename={next => { if (!selected) return; try { const renamed = renameComponent(state, selected, next); setState(renamed); setSelected(next); } catch (e) { return errorText(e); } }}
        onObserve={(enabled, interval) => editRequest(r => ({ ...r, model: { ...r.model, observations: [...r.model.observations.filter(o => o.component !== selected), ...(enabled && selected ? [{ component: selected, samplingInterval: interval }] : [])] } }))}
        onDelete={() => { if (selected) setState(s => removeComponents(s, new Set([selected]))); setSelected(undefined); }} />
    </div>
    <div className="simulation-bar"><div className="simulation-label"><Settings2 size={16} /><strong>Simulation</strong><span className="muted small">Temps simulé</span></div><NumberField label="Début" value={state.request.simulation.start} minimum={-1e9} maximum={1e9} onChange={start => editRequest(r => ({ ...r, simulation: { ...r.simulation, start } }))} /><ArrowRight size={14} className="muted" /><NumberField label="Fin" value={state.request.simulation.end} minimum={-1e9} maximum={1e9} onChange={end => editRequest(r => ({ ...r, simulation: { ...r.simulation, end } }))} /><span className="simulation-observations"><Activity size={14} />{state.request.model.observations.length} observé{state.request.model.observations.length > 1 ? 's' : ''}</span><div className={`simulation-status ${status === 'Échec' ? 'failed' : ''}`} role="status">{status === 'Terminé' && <Check size={14} />}{status}</div><button className="primary" onClick={() => void run()} disabled={busy || health !== 'ready'}><Play size={14} fill="currentColor" />{busy ? 'Calcul en cours…' : 'Exécuter la simulation'}</button></div>
    <ResultsPanel result={result?.data} stale={!!result && result.fingerprint !== currentFingerprint} status={status} error={error} />
    <footer className="app-footer"><span><span className="footer-dot" />{saveStatus}</span><span>libirritator {catalog?.engineVersion ?? '—'}<span className="separator">·</span>Calcul natif C++<span className="separator">·</span>Contrat JSON v1</span></footer>
    {showHelp && <div className="modal-backdrop" onClick={() => setShowHelp(false)}><div className="help-dialog" role="dialog" aria-modal="true" aria-label="Utiliser l’atelier" onClick={e => e.stopPropagation()}><button autoFocus className="icon-button modal-close" aria-label="Fermer l’aide" onClick={() => setShowHelp(false)}><X size={18} /></button><h2>Construire. Relier. Simuler.</h2><ol><li>Ajoutez un composant depuis la bibliothèque.</li><li>Sélectionnez-le pour régler ses paramètres et activer son observation.</li><li>Cliquez une sortie puis une entrée, ou utilisez « Relier des ports ».</li><li>Réglez les bornes temporelles puis exécutez.</li><li>Explorez les trajectoires, les points exacts et les détails du calcul.</li></ol><p>Suppr / Retour arrière supprime la sélection. Déplacez les nœuds et utilisez la molette pour zoomer. Les boutons du canevas ajustent la vue.</p><p>Enregistrer exporte le JSON scientifique v1. La disposition est conservée séparément dans ce navigateur. Ouvrir accepte notamment <code>web/examples/sum3.json</code>.</p><p className="muted small">Les événements à la borne finale sont exclus. Le moteur peut publier un état terminal lors de la fermeture des observations.</p><button onClick={() => setShowHelp(false)}>Fermer l’aide</button></div></div>}
  </div>;
}
