import { Handle, Position } from '@xyflow/react';
import type { Node, NodeProps } from '@xyflow/react';

export type StateNodeData = {
  label:      string;
  kind:       string;
  status:     string | undefined;
  isInitial:  boolean;
  isTerminal: boolean;
};

export type StateNodeType = Node<StateNodeData, 'stateNode'>;

const STATUS_BG: Record<string, string> = {
  active:    'bg-blue-500 text-white border-blue-600',
  waiting:   'bg-amber-400 text-white border-amber-500',
  completed: 'bg-green-500 text-white border-green-600',
  idle:      'bg-slate-100 text-slate-600 border-slate-300',
};

const KIND_ICON: Record<string, string> = {
  fork:           '⑂',
  join:           '⑁',
  wait: '⤴',
};

export function StateNode({ data }: NodeProps<StateNodeType>) {
  const status   = data.status ?? 'idle';
  const colorCls = STATUS_BG[status] ?? STATUS_BG['idle'];
  const icon     = KIND_ICON[data.kind];

  return (
    <div className={`rounded-lg border-2 px-3 py-2 min-w-[130px] text-center shadow-sm ${colorCls}`}>
      <Handle type="target" position={Position.Top} className="!bg-slate-400" />

      <p className="text-xs font-semibold leading-tight">
        {data.label}
        {icon ? <span className="ml-1 opacity-70">{icon}</span> : null}
      </p>

      <p className="text-[10px] opacity-60 mt-0.5 capitalize">{status}</p>

      {data.isInitial  ? <span className="text-[9px] opacity-50 block">▶ initial</span> : null}
      {data.isTerminal ? <span className="text-[9px] opacity-50 block">■ terminal</span> : null}

      <Handle type="source" position={Position.Bottom} className="!bg-slate-400" />
    </div>
  );
}
