import type { NodeKind } from '../types';

interface Props {
  onAddNode: (kind: NodeKind) => void;
}

const BUTTONS: { kind: NodeKind; label: string; title: string; color: string }[] = [
  { kind: 'step', label: 'Step',   title: 'Add a step state (waits for an action)', color: 'border-slate-600 text-slate-300 hover:border-slate-400 hover:text-white hover:bg-slate-700' },
  { kind: 'fork', label: '⑂ Fork', title: 'Add a fork — splits into parallel branches',  color: 'border-violet-700 text-violet-400 hover:border-violet-500 hover:bg-violet-900/40' },
  { kind: 'join', label: '⑁ Join', title: 'Add a join — synchronises parallel branches', color: 'border-cyan-700 text-cyan-400 hover:border-cyan-500 hover:bg-cyan-900/40' },
  { kind: 'wait', label: '⏸ Wait', title: 'Add a wait state — pauses for an external signal', color: 'border-amber-700 text-amber-400 hover:border-amber-500 hover:bg-amber-900/40' },
];

export function DesignerToolbar({ onAddNode }: Props) {
  return (
    <div className="absolute top-3 left-3 z-10 flex gap-1.5 items-center">
      <span className="text-[10px] text-slate-600 mr-1 select-none">add:</span>
      {BUTTONS.map(({ kind, label, title, color }) => (
        <button
          key={kind}
          title={title}
          onClick={() => onAddNode(kind)}
          className={`text-xs font-medium border rounded px-2.5 py-1 bg-slate-900/80 backdrop-blur transition-colors ${color}`}
        >
          {label}
        </button>
      ))}
      <span className="ml-3 text-[10px] text-slate-700 select-none hidden sm:block">
        drag to connect · backspace to delete
      </span>
    </div>
  );
}
