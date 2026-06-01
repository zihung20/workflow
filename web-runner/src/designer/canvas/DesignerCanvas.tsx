import { useCallback, useEffect, useRef } from 'react';
import {
  ReactFlow, Background, BackgroundVariant, Controls,
  useNodesState, useEdgesState,
} from '@xyflow/react';
import type { Node, Edge, Connection, NodeChange, EdgeChange, OnConnect } from '@xyflow/react';
import { DesignerToolbar } from './DesignerToolbar';
import { DesignerStateNode } from './DesignerStateNode';
import type { DesignerWorkflow, DesignerNode, DesignerEdge, NodeKind, Selection } from '../types';

const NODE_TYPES = { 'designer-node': DesignerStateNode };

const POSITIONS_KEY = 'flowyd-positions';

function loadSavedPositions(): Map<string, { x: number; y: number }> {
  try {
    const raw = localStorage.getItem(POSITIONS_KEY);
    if (raw) return new Map(JSON.parse(raw) as [string, { x: number; y: number }][]);
  } catch { /* ignore */ }
  return new Map();
}

function savePositions(nodes: Node[]): void {
  const data = nodes.map(n => [n.id, n.position] as [string, { x: number; y: number }]);
  localStorage.setItem(POSITIONS_KEY, JSON.stringify(data));
}

function wfStructureKey(wf: DesignerWorkflow): string {
  const n = wf.nodes.map(n => `${n.id}:${n.kind}:${n.label}:${n.isInitial ? 1 : 0}:${n.isTerminal ? 1 : 0}:${n.forkTargets.join(',')}:${n.joinRequires.join(',')}`).join('|');
  const e = wf.edges.map(e => `${e.id}:${e.fromNodeId}:${e.toNodeId}:${e.kind}:${e.actionName}`).join('|');
  return `${wf.name}||${n}||${e}`;
}

function wfToRfNodes(
  wf: DesignerWorkflow,
  existingPositions: Map<string, { x: number; y: number }>,
  savedPositions: Map<string, { x: number; y: number }>,
): Node[] {
  return wf.nodes.map((n, i) => ({
    id: n.id,
    type: 'designer-node',
    position:
      existingPositions.get(n.id) ??
      savedPositions.get(n.id) ??
      { x: 80 + (i % 4) * 220, y: 80 + Math.floor(i / 4) * 140 },
    data: n as unknown as Record<string, unknown>,
  }));
}

function wfToRfEdges(wf: DesignerWorkflow): Edge[] {
  const edges: Edge[] = wf.edges.map(e => ({
    id: e.id,
    source: e.fromNodeId,
    target: e.toNodeId,
    label: e.kind === 'fork-target' ? '⑂ auto' : (e.actionName || '—'),
    animated: false,
    style: e.kind === 'fork-target'
      ? { strokeDasharray: '5 3', stroke: '#7c3aed', strokeWidth: 1.5 }
      : { stroke: '#64748b', strokeWidth: 1.5 },
    labelStyle: { fontSize: 11, fontFamily: 'monospace' },
    labelBgStyle: { fill: '#0f172a', fillOpacity: 0.9 },
    data: {} as Record<string, unknown>,
  }));

  // Synthetic join-requires edges — visual only, not stored in wf.edges.
  // Derived from node.joinRequires so they stay in sync with the NodePanel checkboxes.
  for (const node of wf.nodes) {
    if (node.kind !== 'join') continue;
    for (const reqId of node.joinRequires) {
      edges.push({
        id: `__jr-${reqId}-${node.id}`,
        source: reqId,
        target: node.id,
        label: '⑁ requires',
        animated: false,
        deletable: false,
        selectable: false,
        focusable: false,
        style: { strokeDasharray: '5 3', stroke: '#0ea5e9', strokeWidth: 1.5 },
        labelStyle: { fontSize: 11, fontFamily: 'monospace' },
        labelBgStyle: { fill: '#0f172a', fillOpacity: 0.9 },
        data: {} as Record<string, unknown>,
      });
    }
  }

  return edges;
}

let nodeCounter = 1;
function makeNewNode(kind: NodeKind, existingIds: Set<string>): DesignerNode {
  let id: string;
  do { id = `${kind}-${nodeCounter++}`; } while (existingIds.has(id));
  return { id, kind, label: id, isInitial: false, isTerminal: false, forkTargets: [], joinRequires: [], joinMode: 'all', waitExternalName: '' };
}

interface Props {
  workflow: DesignerWorkflow;
  selection: Selection;
  onWorkflowChange: (wf: DesignerWorkflow) => void;
  onSelectionChange: (sel: Selection) => void;
}

export function DesignerCanvas({ workflow, selection, onWorkflowChange, onSelectionChange }: Props) {
  const savedPositions = useRef(loadSavedPositions());
  const prevKeyRef = useRef('');

  const [rfNodes, setRfNodes, onRfNodesChange] = useNodesState<Node>([]);
  const [rfEdges, setRfEdges, onRfEdgesChange] = useEdgesState<Edge>([]);

  // Sync from workflow prop whenever the structure changes
  useEffect(() => {
    const key = wfStructureKey(workflow);
    if (key === prevKeyRef.current) return;
    prevKeyRef.current = key;

    setRfNodes(prev => {
      const existingPos = new Map(prev.map(n => [n.id, n.position]));
      return wfToRfNodes(workflow, existingPos, savedPositions.current);
    });
    setRfEdges(wfToRfEdges(workflow));
  }, [workflow, setRfNodes, setRfEdges]);

  // Reflect selection state via node/edge `selected` flag
  useEffect(() => {
    setRfNodes(prev => prev.map(n => ({
      ...n,
      selected: selection.type === 'node' && selection.id === n.id,
    })));
    setRfEdges(prev => prev.map(e => ({
      ...e,
      selected: selection.type === 'edge' && selection.id === (e.data as Record<string, unknown>)?.edgeId,
    })));
  }, [selection, setRfNodes, setRfEdges]);

  const handleNodesChange = useCallback((changes: NodeChange[]) => {
    onRfNodesChange(changes);

    for (const change of changes) {
      // Save positions when drag ends
      if (change.type === 'position' && change.dragging === false) {
        setRfNodes(current => {
          savePositions(current);
          savedPositions.current = new Map(current.map(n => [n.id, n.position]));
          return current;
        });
        break;
      }
      // Handle deletion (Backspace key)
      if (change.type === 'remove') {
        const id = change.id;
        onWorkflowChange({
          ...workflow,
          nodes: workflow.nodes.filter(n => n.id !== id),
          edges: workflow.edges.filter(e => e.fromNodeId !== id && e.toNodeId !== id),
        });
        onSelectionChange({ type: 'none' });
        return;
      }
    }
  }, [workflow, onRfNodesChange, onWorkflowChange, onSelectionChange, setRfNodes]);

  const handleEdgesChange = useCallback((changes: EdgeChange[]) => {
    onRfEdgesChange(changes);
    for (const change of changes) {
      if (change.type === 'remove') {
        // ReactFlow edge ID equals DesignerEdge.id (set identically in handleConnect and wfToRfEdges)
        onWorkflowChange({ ...workflow, edges: workflow.edges.filter(e => e.id !== change.id) });
        onSelectionChange({ type: 'none' });
        return;
      }
    }
  }, [workflow, onRfEdgesChange, onWorkflowChange, onSelectionChange]);

  const handleConnect: OnConnect = useCallback((connection: Connection) => {
    const from = connection.source;
    const to = connection.target;
    if (!from || !to) return;
    const sourceNode = workflow.nodes.find(n => n.id === from);
    const targetNode = workflow.nodes.find(n => n.id === to);

    // Drawing to a join auto-adds the source to that join's requires list.
    // A synthetic visual edge is rendered from node.joinRequires — no stored edge needed.
    if (targetNode?.kind === 'join') {
      const updatedNodes = workflow.nodes.map(n =>
        n.id === to && !n.joinRequires.includes(from)
          ? { ...n, joinRequires: [...n.joinRequires, from] }
          : n,
      );
      onWorkflowChange({ ...workflow, nodes: updatedNodes });
      return;
    }

    const kind: DesignerEdge['kind'] = sourceNode?.kind === 'fork' ? 'fork-target' : 'transition';
    const newEdge: DesignerEdge = {
      id: `e-${from}-${to}-${Date.now()}`,
      fromNodeId: from, toNodeId: to, kind,
      actionName: kind === 'transition' ? 'ACTION' : '',
      guardBody: '',
    };
    onWorkflowChange({ ...workflow, edges: [...workflow.edges, newEdge] });
    onSelectionChange({ type: 'edge', id: newEdge.id });
    // Immediately add to rfEdges for instant visual feedback; the useEffect
    // will reconcile it on the next render cycle from the updated workflow prop.
    setRfEdges(es => [...es, {
      id: newEdge.id, source: from, target: to,
      label: kind === 'fork-target' ? '⑂ auto' : 'ACTION',
      style: kind === 'fork-target' ? { strokeDasharray: '5 3', stroke: '#7c3aed', strokeWidth: 1.5 } : { stroke: '#64748b', strokeWidth: 1.5 },
      labelStyle: { fontSize: 11, fontFamily: 'monospace' },
      labelBgStyle: { fill: '#0f172a', fillOpacity: 0.85 },
      data: {} as Record<string, unknown>,
    }]);
  }, [workflow, onWorkflowChange, onSelectionChange, setRfEdges]);

  const handleAddNode = useCallback((kind: NodeKind) => {
    const ids = new Set(workflow.nodes.map(n => n.id));
    const node = makeNewNode(kind, ids);
    const pos = { x: 120 + (workflow.nodes.length % 4) * 220, y: 120 + Math.floor(workflow.nodes.length / 4) * 140 };
    onWorkflowChange({ ...workflow, nodes: [...workflow.nodes, node] });
    savedPositions.current.set(node.id, pos);
  }, [workflow, onWorkflowChange]);

  return (
    <div className="w-full h-full relative bg-[#0f172a]">
      <DesignerToolbar onAddNode={handleAddNode} />
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={NODE_TYPES}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={handleConnect}
        onNodeClick={(_, node) => onSelectionChange({ type: 'node', id: node.id })}
        onEdgeClick={(_, edge) => onSelectionChange({ type: 'edge', id: edge.id })}
        onPaneClick={() => onSelectionChange({ type: 'none' })}
        fitView
        fitViewOptions={{ padding: 0.25 }}
        deleteKeyCode="Backspace"
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#334155" />
        <Controls className="!bg-slate-800 !border-slate-600 [&_button]:!bg-slate-800 [&_button]:!text-slate-300 [&_button:hover]:!bg-slate-700 [&_button]:!border-slate-600" />
      </ReactFlow>

      {workflow.nodes.length === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none gap-2">
          <p className="text-slate-500 text-sm font-medium">Start building</p>
          <p className="text-slate-600 text-xs">Use the toolbar above to add states</p>
        </div>
      )}
    </div>
  );
}
