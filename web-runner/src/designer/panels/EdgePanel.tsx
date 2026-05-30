import type { DesignerEdge, EdgeKind } from '../types';

interface Props {
  edge: DesignerEdge;
  onChange: (updated: DesignerEdge) => void;
  onDelete: () => void;
}

const INPUT    = 'w-full rounded border border-slate-700 bg-slate-800 text-slate-100 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder-slate-600';
const TEXTAREA = `${INPUT} font-mono resize-none leading-relaxed`;

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-[10px] font-medium text-slate-500 uppercase tracking-wider">{label}</label>
      {hint && <p className="text-[10px] text-slate-600">{hint}</p>}
      {children}
    </div>
  );
}

export function EdgePanel({ edge, onChange, onDelete }: Props) {
  function set<K extends keyof DesignerEdge>(k: K, v: DesignerEdge[K]) {
    onChange({ ...edge, [k]: v });
  }

  const isFork = edge.kind === 'fork-target';

  return (
    <div className="p-3 space-y-3 text-xs">
      <div className="flex items-center gap-2 text-slate-500 font-mono text-[11px] bg-slate-800/60 rounded px-2 py-1.5">
        <span className="text-slate-400">{edge.fromNodeId}</span>
        <span>→</span>
        <span className="text-slate-400">{edge.toNodeId}</span>
      </div>

      <Row label="Edge type">
        <select className={INPUT} value={edge.kind} onChange={e => set('kind', e.target.value as EdgeKind)}>
          <option value="transition">transition — triggered by dispatching an action</option>
          <option value="fork-target">fork-target — activated automatically by a Fork state</option>
        </select>
      </Row>

      {!isFork && (
        <>
          <Row label="Action name" hint="Convention: ALL_CAPS. Must match a defineAction() call.">
            <input
              className={INPUT}
              value={edge.actionName}
              onChange={e => set('actionName', e.target.value.toUpperCase().replace(/\s+/g, '_'))}
              placeholder="SUBMIT"
            />
          </Row>

          <Row
            label="Guard (optional)"
            hint="Return true to allow. ctx.payload is typed to this action's schema."
          >
            <textarea
              rows={4}
              className={TEXTAREA}
              value={edge.guardBody}
              onChange={e => set('guardBody', e.target.value)}
              placeholder={`// e.g.\nreturn ctx.payload.amount > 1000;`}
              spellCheck={false}
            />
          </Row>
        </>
      )}

      <button
        onClick={onDelete}
        className="w-full text-[11px] text-red-500 border border-red-900/60 rounded py-1.5 hover:bg-red-900/20 transition-colors"
      >
        Delete transition
      </button>
    </div>
  );
}
