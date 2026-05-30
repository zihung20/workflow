import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import type { DesignerNode, NodeKind } from '../types';

const KIND_STYLES: Record<NodeKind, { border: string; bg: string; badge: string; badgeText: string; icon: string }> = {
  step: { border: '#475569', bg: '#1e293b', badge: '', badgeText: '', icon: '' },
  fork: { border: '#7c3aed', bg: '#2e1065', badge: 'bg-violet-900/60 text-violet-300', badgeText: 'fork', icon: '⑂' },
  join: { border: '#0e7490', bg: '#083344', badge: 'bg-cyan-900/60 text-cyan-300', badgeText: 'join', icon: '⑁' },
  wait: { border: '#92400e', bg: '#1c1917', badge: 'bg-amber-900/60 text-amber-300', badgeText: 'wait', icon: '⏸' },
};

export function DesignerStateNode({ data, selected }: NodeProps) {
  // ReactFlow boundary cast: this node type always carries DesignerNode data
  const node = data as unknown as DesignerNode;
  const s = KIND_STYLES[node.kind] ?? KIND_STYLES.step;

  return (
    <div
      style={{
        borderColor: selected ? '#3b82f6' : s.border,
        backgroundColor: s.bg,
        boxShadow: selected ? `0 0 0 2px #3b82f6, 0 4px 12px rgba(0,0,0,0.5)` : '0 2px 8px rgba(0,0,0,0.4)',
      }}
      className="rounded-lg border-2 min-w-[130px] overflow-hidden transition-shadow"
    >
      <Handle type="target" position={Position.Top} style={{ background: '#475569', width: 8, height: 8 }} />

      <div className="px-3 py-2.5 text-center">
        <p className="text-xs font-semibold text-slate-100 leading-tight truncate max-w-[150px] mx-auto">
          {node.label || node.id}
        </p>
        {node.id !== node.label && (
          <p className="text-[10px] text-slate-500 mt-0.5 font-mono truncate max-w-[150px] mx-auto">
            {node.id}
          </p>
        )}
      </div>

      {(node.kind !== 'step' || node.isInitial || node.isTerminal) && (
        <div className="flex items-center justify-center gap-1 px-2 pb-2 flex-wrap">
          {node.kind !== 'step' && s.badge && (
            <span className={`text-[9px] font-medium rounded px-1.5 py-0.5 ${s.badge}`}>
              {s.icon} {s.badgeText}
            </span>
          )}
          {node.isInitial && (
            <span className="text-[9px] font-medium rounded px-1.5 py-0.5 bg-green-900/60 text-green-400">
              ▶ initial
            </span>
          )}
          {node.isTerminal && (
            <span className="text-[9px] font-medium rounded px-1.5 py-0.5 bg-rose-900/60 text-rose-400">
              ■ terminal
            </span>
          )}
        </div>
      )}

      <Handle type="source" position={Position.Bottom} style={{ background: '#475569', width: 8, height: 8 }} />
    </div>
  );
}
