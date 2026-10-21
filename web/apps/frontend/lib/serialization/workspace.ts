import { deserializeModel, validateEditorDocument, type EditorState } from '@/lib/modeling/model';

export const storageKey = 'irritator.workspace.v1';
export function saveWorkspace(state: EditorState): string {
  validateEditorDocument(state.request);
  return JSON.stringify({ workspaceVersion: 1, ...state });
}
export function loadWorkspace(text: string): EditorState {
  const parsed = JSON.parse(text) as Record<string, unknown>;
  if (parsed.workspaceVersion !== 1) throw new Error('Version de sauvegarde locale inconnue.');
  const editor = deserializeModel(parsed.request);
  if (parsed.positions && typeof parsed.positions === 'object') {
    for (const c of editor.request.model.components) {
      const p = (parsed.positions as Record<string, { x?: unknown; y?: unknown }>)[c.id];
      if (p && typeof p.x === 'number' && typeof p.y === 'number' && Number.isFinite(p.x) && Number.isFinite(p.y)) editor.positions[c.id] = { x: p.x, y: p.y };
    }
  }
  const v = parsed.viewport as EditorState['viewport'] | undefined;
  if (v && [v.x, v.y, v.zoom].every(Number.isFinite) && v.zoom >= 0.2 && v.zoom <= 2) editor.viewport = v;
  return editor;
}
export function downloadFile(content: string, name: string, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
