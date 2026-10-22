import { deserializeModel, validateEditorDocument, type EditorState } from '@/lib/modeling/model';

export const storageKey = 'irritator.workspace.v2';
export const legacyStorageKey = 'irritator.workspace.v1';
export function saveWorkspace(state: EditorState): string {
  validateEditorDocument(state.request);
  return JSON.stringify({ workspaceVersion: 2, ...state });
}
export function loadWorkspace(text: string): EditorState {
  const parsed = JSON.parse(text) as Record<string, unknown>;
  if (parsed.workspaceVersion !== 1 && parsed.workspaceVersion !== 2) throw new Error('Version de sauvegarde locale inconnue.');
  const editor = deserializeModel(parsed.request);
  if (parsed.positions && typeof parsed.positions === 'object') {
    for (const c of editor.request.model.components) {
      const p = (parsed.positions as Record<string, { x?: unknown; y?: unknown }>)[c.id];
      if (p && typeof p.x === 'number' && typeof p.y === 'number' && Number.isFinite(p.x) && Number.isFinite(p.y)) editor.positions[c.id] = { x: p.x, y: p.y };
    }
  }
  const v = parsed.viewport as EditorState['viewport'] | undefined;
  if (v && [v.x, v.y, v.zoom].every(Number.isFinite) && v.zoom >= 0.2 && v.zoom <= 2) editor.viewport = v;
  if (parsed.workspaceVersion === 2 && parsed.scopes && typeof parsed.scopes === 'object') {
    editor.scopes = {};
    for (const d of editor.request.model.definitions ?? []) {
      const candidate = (parsed.scopes as Record<string, unknown>)[d.id] as EditorState | undefined;
      if (!candidate || typeof candidate !== 'object') continue;
      const positions: EditorState['positions'] = {};
      for (const c of [...d.components, { id: '$input' }, { id: '$output' }]) {
        const p = candidate.positions?.[c.id];
        if (p && [p.x, p.y].every(Number.isFinite)) positions[c.id] = p;
      }
      const camera = candidate.viewport;
      editor.scopes[d.id] = { positions, viewport: camera && [camera.x, camera.y, camera.zoom].every(Number.isFinite) && camera.zoom >= .2 && camera.zoom <= 2 ? camera : { x: 70, y: 45, zoom: 1 } };
    }
    if (typeof parsed.activeScope === 'string' && editor.request.model.definitions?.some(d => d.id === parsed.activeScope)) editor.activeScope = parsed.activeScope;
    if (Array.isArray(parsed.scopeTrail)) editor.scopeTrail = parsed.scopeTrail.filter((id): id is string => typeof id === 'string' && !!editor.request.model.definitions?.some(d => d.id === id)).slice(0, 8);
  }
  return editor;
}
export function downloadFile(content: string, name: string, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
