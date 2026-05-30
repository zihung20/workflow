import { useCallback, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ReactFlowProvider } from '@xyflow/react';

import { DesignerCanvas } from '../designer/canvas/DesignerCanvas';
import { CodeEditor } from '../designer/code/CodeEditor';
import type { CodeEditorHandle } from '../designer/code/CodeEditor';
import { NodePanel } from '../designer/panels/NodePanel';
import { EdgePanel } from '../designer/panels/EdgePanel';
import { SingleRunner } from '../runners/SingleRunner';

import { useDesignerWorkflow } from '../designer/hooks/useDesignerWorkflow';
import { useCodeSync } from '../designer/hooks/useCodeSync';
import { useRunState } from '../designer/hooks/useRunState';
import { useTheme } from '../context/ThemeContext';

import type { DesignerWorkflow, DesignerNode, DesignerEdge, Selection } from '../designer/types';

export default function DesignerPage() {
  const { workflow, setWorkflow, initialCode, resetToDefault } = useDesignerWorkflow();
  const [selection, setSelection] = useState<Selection>({ type: 'none' });
  const [evalError, setEvalError]  = useState<string | null>(null);
  const { runState, setRunState, handleRun } = useRunState();
  const { theme, toggleTheme } = useTheme();

  const editorRef   = useRef<CodeEditorHandle>(null);
  const workflowRef = useRef<DesignerWorkflow>(workflow);
  workflowRef.current = workflow;

  const { pushCode, handleCodeChange } = useCodeSync({
    editorRef,
    workflowRef,
    setWorkflow,
    onEvalError: setEvalError,
  });

  // Canvas structural changes regenerate code
  const handleWorkflowChange = useCallback((wf: DesignerWorkflow) => {
    setWorkflow(wf);
    pushCode(wf);
  }, [setWorkflow, pushCode]);

  // ── Selection-driven panel edits ─────────────────────────────────────────

  const selectedNode = selection.type === 'node'
    ? workflow.nodes.find(n => n.id === selection.id) ?? null
    : null;
  const selectedEdge = selection.type === 'edge'
    ? workflow.edges.find(e => e.id === selection.id) ?? null
    : null;

  function handleNodeChange(updated: DesignerNode) {
    const oldId = selection.type === 'node' ? selection.id : updated.id;
    const nodes = workflow.nodes.map(n => n.id === oldId ? updated : n);
    const edges = updated.id !== oldId
      ? workflow.edges.map(e => ({
          ...e,
          fromNodeId: e.fromNodeId === oldId ? updated.id : e.fromNodeId,
          toNodeId:   e.toNodeId   === oldId ? updated.id : e.toNodeId,
        }))
      : workflow.edges;
    if (updated.id !== oldId && selection.type === 'node') setSelection({ type: 'node', id: updated.id });
    handleWorkflowChange({ ...workflow, nodes, edges });
  }

  function handleEdgeChange(updated: DesignerEdge) {
    handleWorkflowChange({ ...workflow, edges: workflow.edges.map(e => e.id === updated.id ? updated : e) });
  }

  function handleDeleteNode() {
    if (selection.type !== 'node') return;
    const id = selection.id;
    handleWorkflowChange({
      ...workflow,
      nodes: workflow.nodes.filter(n => n.id !== id),
      edges: workflow.edges.filter(e => e.fromNodeId !== id && e.toNodeId !== id),
    });
    setSelection({ type: 'none' });
  }

  function handleDeleteEdge() {
    if (selection.type !== 'edge') return;
    handleWorkflowChange({ ...workflow, edges: workflow.edges.filter(e => e.id !== selection.id) });
    setSelection({ type: 'none' });
  }

  const hasPanel = selectedNode !== null || selectedEdge !== null;
  const isRunning = runState.mode === 'running';

  return (
    <div className="flex flex-col h-screen overflow-hidden font-sans bg-white dark:bg-[#0f172a]">

      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <header className="shrink-0 h-11 bg-white dark:bg-slate-900 flex items-center px-4 gap-3 border-b border-slate-200 dark:border-slate-700/60 z-10">
        <Link to="/" className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 text-sm transition-colors font-semibold">
          flowyd
        </Link>
        <span className="text-slate-300 dark:text-slate-700">/</span>
        <input
          className="bg-transparent border-none outline-none text-slate-900 dark:text-white text-sm font-medium w-44 placeholder-slate-400"
          value={workflow.name}
          onChange={e => handleWorkflowChange({ ...workflow, name: e.target.value })}
          placeholder="workflow-name"
        />

        {/* Eval error banner */}
        <div className="flex-1 flex items-center justify-center">
          {evalError && (
            <span className="text-xs text-red-500 dark:text-red-400 max-w-sm truncate flex items-center gap-1.5">
              <span>⚠</span> {evalError}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={toggleTheme}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 text-sm transition-colors px-1"
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>
          <button
            onClick={resetToDefault}
            title="Reset canvas to default (clears localStorage)"
            className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
          >
            Reset
          </button>
          <Link
            to="/examples/purchase-order"
            className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
          >
            Examples
          </Link>
          {isRunning && (
            <button
              onClick={() => setRunState({ mode: 'idle' })}
              className="text-xs bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300 rounded px-3 py-1.5 transition-colors"
            >
              Close
            </button>
          )}
          <button
            onClick={() => { void handleRun(() => editorRef.current?.getValue() ?? ''); }}
            className="text-xs bg-blue-600 hover:bg-blue-500 text-white rounded px-3 py-1.5 font-medium transition-colors flex items-center gap-1.5"
          >
            <span>▶</span> Run
          </button>
        </div>
      </header>

      {/* ── Main layout ──────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 flex">

        {/* Canvas panel */}
        <div className="relative flex-1 min-w-0">
          <ReactFlowProvider>
            <DesignerCanvas
              workflow={workflow}
              selection={selection}
              onWorkflowChange={handleWorkflowChange}
              onSelectionChange={setSelection}
            />
          </ReactFlowProvider>
        </div>

        {/* Right column: config panel + code editor */}
        <div className="w-[44%] shrink-0 flex flex-col border-l border-slate-200 dark:border-slate-700/60">

          {/* Config panel — visible when a node or edge is selected */}
          {hasPanel && (
            <div className="shrink-0 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700/60 overflow-y-auto max-h-72">
              <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100 dark:border-slate-800">
                <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  {selectedNode ? 'State' : 'Transition'}
                </span>
                <button
                  onClick={() => setSelection({ type: 'none' })}
                  className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 text-sm transition-colors"
                  title="Close panel"
                >
                  ✕
                </button>
              </div>
              {selectedNode && (
                <NodePanel node={selectedNode} workflow={workflow} onChange={handleNodeChange} onDelete={handleDeleteNode} />
              )}
              {selectedEdge && (
                <EdgePanel edge={selectedEdge} onChange={handleEdgeChange} onDelete={handleDeleteEdge} />
              )}
            </div>
          )}

          {/* Code editor — always vs-dark regardless of app theme */}
          <div className="flex flex-col flex-1 min-h-0">
            <div className="shrink-0 flex items-center px-3 h-8 bg-[#252526] border-b border-[#3c3c3c]">
              <span className="text-[11px] text-slate-400 font-mono">workflow.ts</span>
              <span className="ml-auto text-[10px] text-slate-600">TypeScript · flowyd</span>
            </div>
            <div className="flex-1 min-h-0 bg-[#1e1e1e]">
              <CodeEditor
                ref={editorRef}
                defaultValue={initialCode}
                onChange={handleCodeChange}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── Run panel ────────────────────────────────────────────────────── */}
      {isRunning && (
        <div className="shrink-0 h-72 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 flex overflow-hidden">
          <SingleRunner
            title={`▶ ${runState.definition.name}`}
            subtitle="Live execution of your designed workflow"
            definition={runState.definition}
            makeInstance={() => (runState as Extract<typeof runState, { mode: 'running' }>).workflow.createInstance(`run-${Date.now()}`)}
          />
        </div>
      )}

      {runState.mode === 'error' && (
        <div className="shrink-0 px-4 py-2.5 bg-red-50 dark:bg-red-950 border-t border-red-200 dark:border-red-800 flex items-center gap-3">
          <span className="text-xs text-red-700 dark:text-red-300 flex-1">⚠ {runState.message}</span>
          <button
            onClick={() => setRunState({ mode: 'idle' })}
            className="text-red-400 hover:text-red-600 dark:hover:text-red-300 transition-colors"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
