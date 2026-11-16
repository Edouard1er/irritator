'use client';
import { ModelEditor } from '@/components/editor/model-editor';

/** Separate editor/session state; shares the established editor and native execution service. */
export function LevelTwoWorkspace({ active }: { active: boolean }) {
  return <ModelEditor level={2} active={active}/>;
}
