import { useEffect } from 'react';
import { CodeEditor } from './CodeEditor';
import { generateCode } from './codeGenerator';
import type { DesignerWorkflow } from '../types';

interface Props {
  workflow: DesignerWorkflow;
  onClose(): void;
}

export function ShowCodeModal({ workflow, onClose }: Props) {
  const code = generateCode(workflow);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex flex-col w-full max-w-3xl mx-4 h-[80vh] rounded-lg overflow-hidden shadow-2xl border border-slate-700">
        {/* Header */}
        <div className="shrink-0 flex items-center px-4 h-10 bg-[#252526] border-b border-[#3c3c3c]">
          <span className="text-[12px] text-slate-400 font-mono">workflow.ts</span>
          <span className="ml-auto flex items-center gap-3">
            <span className="text-[11px] text-slate-600">TypeScript · flowyd</span>
            <button
              onClick={() => void navigator.clipboard.writeText(code)}
              className="text-[11px] text-slate-400 hover:text-slate-200 transition-colors"
            >
              Copy
            </button>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-200 transition-colors text-sm leading-none"
              title="Close (Esc)"
            >
              ✕
            </button>
          </span>
        </div>

        {/* Editor */}
        <div className="flex-1 min-h-0 bg-[#1e1e1e]">
          <CodeEditor defaultValue={code} />
        </div>
      </div>
    </div>
  );
}
