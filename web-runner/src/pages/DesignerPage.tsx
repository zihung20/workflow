import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { ReactFlowProvider } from '@xyflow/react';

import { DesignerCanvas } from '../designer/canvas/DesignerCanvas';
import { NodePanel } from '../designer/panels/NodePanel';
import { EdgePanel } from '../designer/panels/EdgePanel';
import { SingleRunner } from '../runners/SingleRunner';
import { ShowCodeModal } from '../designer/code/ShowCodeModal';

import { useDesignerWorkflow } from '../designer/hooks/useDesignerWorkflow';
import { useRunState } from '../designer/hooks/useRunState';
import { useTheme } from '../context/ThemeContext';

import type { DesignerWorkflow, DesignerNode, DesignerEdge, Selection } from '../designer/types';
import { Label } from '../components/ui/label';
import { SchemaEditor } from '../designer/code/SchemaEditor';

export default function DesignerPage() {
  const { workflow, setWorkflow, resetToDefault } = useDesignerWorkflow();
  const [selection, setSelection] = useState<Selection>({ type: 'none' });
  const [showCode, setShowCode] = useState(false);
  const { runState, setRunState, handleRun } = useRunState();
  const { theme, toggleTheme } = useTheme();

  const handleWorkflowChange = useCallback((wf: DesignerWorkflow) => {
    setWorkflow(wf);
  }, [setWorkflow]);

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

  function handleSchemaChange(actionName: string, body: string) {
    handleWorkflowChange({
      ...workflow,
      actionSchemas: { ...workflow.actionSchemas, [actionName]: body },
    });
  }

  function handleContextSchemaChange(body: string) {
    handleWorkflowChange({ ...workflow, contextSchemaBody: body });
  }

  const hasPanel = selectedNode !== null || selectedEdge !== null || selection.type === 'settings';
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

        <div className="flex-1" />

        <div className="flex items-center gap-2">
          <button
            onClick={toggleTheme}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 text-sm transition-colors px-1"
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>
          <button
            onClick={() => {
              resetToDefault();
              setSelection({ type: 'none' });
            }}
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
          {/* Context / settings panel toggle */}
          <button
            onClick={() => setSelection(s => s.type === 'settings' ? { type: 'none' } : { type: 'settings' })}
            title="Workflow context & settings"
            className={`text-xs border rounded px-2.5 py-1 transition-colors ${
              selection.type === 'settings'
                ? 'bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 border-slate-300 dark:border-slate-600'
                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 border-slate-200 dark:border-slate-700'
            }`}
          >
            Context
          </button>
          <button
            onClick={() => setShowCode(true)}
            className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 border border-slate-200 dark:border-slate-700 rounded px-2.5 py-1 transition-colors"
          >
            {'</>'}  Show Code
          </button>
          {isRunning && (
            <button
              onClick={() => setRunState({ mode: 'idle' })}
              className="text-xs bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300 rounded px-3 py-1.5 transition-colors"
            >
              Close
            </button>
          )}
          <button
            onClick={() => { void handleRun(workflow); }}
            className="text-xs bg-blue-600 hover:bg-blue-500 text-white rounded px-3 py-1.5 font-medium transition-colors flex items-center gap-1.5"
          >
            <span>▶</span> Run
          </button>
        </div>
      </header>

      {/* ── Main canvas area ──────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 relative">
        <ReactFlowProvider>
          <DesignerCanvas
            workflow={workflow}
            selection={selection}
            onWorkflowChange={handleWorkflowChange}
            onSelectionChange={setSelection}
          />
        </ReactFlowProvider>

        {/* Floating config panel — overlays canvas on the right */}
        {hasPanel && (
          <div className="absolute top-0 right-0 h-full w-72 bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-700/60 shadow-xl overflow-y-auto z-10">
            <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100 dark:border-slate-800 sticky top-0 bg-white dark:bg-slate-900">
              <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                {selection.type === 'settings' ? 'Workflow' : selectedNode ? 'State' : 'Transition'}
              </span>
              <button
                onClick={() => setSelection({ type: 'none' })}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 text-sm transition-colors"
                title="Close panel"
              >
                ✕
              </button>
            </div>

            {/* Workflow settings panel */}
            {selection.type === 'settings' && (
              <div className="p-3 space-y-3">
                <div className="space-y-1.5">
                  <Label>Context schema</Label>
                  <p className="text-[10px] text-muted-foreground">
                    Zod object fields for <code className="font-mono">ctx.context</code>.
                    Generates <code className="font-mono">.setContext(z.object({'{'}...{'}'}))</code>.
                  </p>
                  <SchemaEditor
                    id="context"
                    value={workflow.contextSchemaBody}
                    onChange={handleContextSchemaChange}
                  />
                </div>
              </div>
            )}

            {selectedNode && (
              <NodePanel node={selectedNode} workflow={workflow} onChange={handleNodeChange} onDelete={handleDeleteNode} />
            )}
            {selectedEdge && (
              <EdgePanel
                edge={selectedEdge}
                workflow={workflow}
                onChange={handleEdgeChange}
                onSchemaChange={handleSchemaChange}
                onDelete={handleDeleteEdge}
              />
            )}
          </div>
        )}
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

      {/* ── Show Code modal ──────────────────────────────────────────────── */}
      {showCode && (
        <ShowCodeModal workflow={workflow} onClose={() => setShowCode(false)} />
      )}
    </div>
  );
}
