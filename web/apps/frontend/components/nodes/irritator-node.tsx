'use client';
import { useEffect } from 'react';
import { Handle, Position, useUpdateNodeInternals, type Node, type NodeProps } from '@xyflow/react';
import { Activity, Box, Eye, Sigma, TriangleAlert } from 'lucide-react';
import type { Component } from '@contracts';
import { handleId, parameterError, type ComponentSpec } from '@/lib/modeling/model';

export type IrritatorNode = Node<{ component: Component; spec?: ComponentSpec; observed: boolean; onOpen?: () => void; prospectiveName?: string }, 'irritator'>;
export function IrritatorNodeView({ data, selected }: NodeProps<IrritatorNode>) {
  const { component: c, spec, observed } = data;
  const updateNodeInternals = useUpdateNodeInternals();
  // A restored document may render before the HTTP catalogue. Handle geometry
  // must be measured again even when the node's outer dimensions stay equal.
  useEffect(() => { if (spec) updateNodeInternals(c.id); }, [c.id, spec, updateNodeInternals]);
  const invalid = !spec || Object.entries(spec.parameters).some(([key, bounds]) => parameterError(c.parameters[key] ?? NaN, bounds));
  const rows = Math.max(spec?.inputs.length ?? 0, spec?.outputs.length ?? 0, 1);
  return <div className={`model-node ${c.experiment ? 'wrapper-node' : ''} ${selected ? 'is-selected' : ''} ${invalid ? 'has-error' : ''}`} data-testid={`node-${c.id}`}>
    <div className={`node-header ${spec?.inputs.length === 0 ? 'source' : c.type.includes('sum') ? 'operator' : 'integrator'}`}>
      <span className="node-symbol">{spec?.inputs.length === 0 ? <Box size={15} /> : c.type.includes('sum') ? <Sigma size={17} /> : <Activity size={15} />}</span>
      <strong>{c.id}</strong>{observed && <Eye size={13} aria-label="Observé" />}{invalid && <TriangleAlert size={14} aria-label="Configuration invalide" />}
    </div>
    <div className="node-type">{c.type.startsWith('coupled:') ? `▣ ${spec?.name ?? c.definition} · couplé` : c.type}</div>
    {c.experiment && <div className="node-type">Prospectif : {data.prospectiveName ?? c.experiment.definition}</div>}
    {data.onOpen && <button className="nodrag" onClick={data.onOpen}>{c.experiment ? 'Ouvrir le prospectif' : 'Ouvrir le contenu'}</button>}
    <div className="node-ports" style={{ height: rows * 25 + 8 }}>
      {spec?.inputs.map((p, row) => <div key={`in${p.port}`} className="port input-port" style={{ top: row * 25 + 7 }}>
        <Handle type="target" position={Position.Left} id={handleId('in', p.port)} aria-label={`${c.id} entrée ${p.port}`} /><span>{p.name}<small>{p.port}</small></span>
      </div>)}
      {spec?.outputs.map((p, row) => <div key={`out${p.port}`} className="port output-port" style={{ top: row * 25 + 7 }}>
        <span><small>{p.port}</small>{p.name}</span><Handle type="source" position={Position.Right} id={handleId('out', p.port)} aria-label={`${c.id} sortie ${p.port}`} />
      </div>)}
    </div>
    {!!Object.keys(c.parameters).length && <div className="node-parameters">{Object.entries(c.parameters).map(([k, v]) => <span key={k}>{k} <b>{Number.isFinite(v) ? v : '?'}</b></span>)}</div>}
  </div>;
}
