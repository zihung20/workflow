import type { DesignerNode, DesignerWorkflow, NodeKind } from '../types';

interface Props {
  node: DesignerNode;
  workflow: DesignerWorkflow;
  onChange: (updated: DesignerNode) => void;
  onDelete: () => void;
}

const KIND_OPTIONS: { value: NodeKind; label: string }[] = [
  { value: 'step', label: 'Step — waits for an action' },
  { value: 'fork', label: 'Fork — activates parallel branches' },
  { value: 'join', label: 'Join — synchronises branches' },
  { value: 'wait', label: 'Wait — pauses for external signal' },
];

const INPUT = 'w-full rounded border border-slate-700 bg-slate-800 text-slate-100 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder-slate-600';
const CHECK = 'w-3.5 h-3.5 rounded border-slate-600 bg-slate-800 text-blue-500';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-[10px] font-medium text-slate-500 uppercase tracking-wider">{label}</label>
      {children}
    </div>
  );
}

export function NodePanel({ node, workflow, onChange, onDelete }: Props) {
  const others = workflow.nodes.filter(n => n.id !== node.id);

  function set<K extends keyof DesignerNode>(k: K, v: DesignerNode[K]) {
    onChange({ ...node, [k]: v });
  }

  function toggleRequire(id: string) {
    set('joinRequires', node.joinRequires.includes(id)
      ? node.joinRequires.filter(r => r !== id)
      : [...node.joinRequires, id]);
  }

  return (
    <div className="p-3 space-y-3 text-xs">
      <Row label="State ID">
        <input className={INPUT} value={node.id} onChange={e => set('id', e.target.value)} placeholder="state-id" />
      </Row>

      <Row label="Label">
        <input className={INPUT} value={node.label} onChange={e => set('label', e.target.value)} placeholder="Display label" />
      </Row>

      <Row label="Kind">
        <select className={INPUT} value={node.kind} onChange={e => set('kind', e.target.value as NodeKind)}>
          {KIND_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </Row>

      <Row label="Flags">
        <div className="flex gap-4 pt-0.5">
          {([['isInitial', '▶ Initial'], ['isTerminal', '■ Terminal']] as const).map(([key, lbl]) => (
            <label key={key} className="flex items-center gap-1.5 cursor-pointer text-slate-400 hover:text-slate-200 transition-colors">
              <input type="checkbox" className={CHECK} checked={node[key] as boolean} onChange={e => set(key, e.target.checked)} />
              {lbl}
            </label>
          ))}
        </div>
      </Row>

      {node.kind === 'join' && (
        <>
          <Row label="Requires (select states)">
            <div className="space-y-1.5 pt-0.5 max-h-28 overflow-y-auto">
              {others.length === 0 && <p className="text-slate-600 italic text-[11px]">Add other states first</p>}
              {others.map(n => (
                <label key={n.id} className="flex items-center gap-2 cursor-pointer text-slate-400 hover:text-slate-200 transition-colors">
                  <input type="checkbox" className={CHECK} checked={node.joinRequires.includes(n.id)} onChange={() => toggleRequire(n.id)} />
                  <span className="font-mono">{n.id}</span>
                </label>
              ))}
            </div>
          </Row>

          <Row label="Mode">
            <select className={INPUT}
              value={typeof node.joinMode === 'number' ? 'quorum' : node.joinMode}
              onChange={e => { const v = e.target.value; set('joinMode', v === 'quorum' ? 2 : (v as 'all' | 'any')); }}>
              <option value="all">all — every required state must complete</option>
              <option value="any">any — at least one must complete</option>
              <option value="quorum">quorum — N states must complete</option>
            </select>
          </Row>

          {typeof node.joinMode === 'number' && (
            <Row label="Quorum count">
              <input type="number" min={1} className={INPUT} value={node.joinMode}
                onChange={e => set('joinMode', Math.max(1, parseInt(e.target.value) || 1))} />
            </Row>
          )}
        </>
      )}

      {node.kind === 'wait' && (
        <Row label="External name">
          <input className={INPUT} value={node.waitExternalName} onChange={e => set('waitExternalName', e.target.value)} placeholder="external-service-name" />
        </Row>
      )}

      <button
        onClick={onDelete}
        className="w-full text-[11px] text-red-500 border border-red-900/60 rounded py-1.5 hover:bg-red-900/20 transition-colors mt-1"
      >
        Delete state
      </button>
    </div>
  );
}
