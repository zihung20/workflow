import { useMemo } from 'react';
import { ReactFlow, Controls, Background, BackgroundVariant } from '@xyflow/react';
import type { Node, Edge } from '@xyflow/react';
import { JsonGraphExporter } from 'flowyd/visualization';
import type { JsonGraph, JsonGraphNode, JsonGraphEdge } from 'flowyd/visualization';
// @dagrejs/dagre v3 bundles graphlib; the `any` casts below isolate the interop
// surface so the rest of the file remains fully typed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import dagre from '@dagrejs/dagre';
import { StateNode } from './StateNode';
import type { StateNodeType } from './StateNode';
import { useRunner } from '../context';

const NODE_W = 180;
const NODE_H = 64;

// Object reference must be stable — defined outside the component.
const nodeTypes = { stateNode: StateNode };

function dagreLayout(
  nodes: JsonGraphNode[],
  edges: JsonGraphEdge[],
): Map<string, { x: number; y: number }> {
  // dagre.graphlib.Graph and dagre.layout are the public runtime API.
  // The cast is necessary because @dagrejs/dagre v3 publishes types that
  // reference @dagrejs/graphlib as a separate peer, which is not installed.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = dagre as any;
  const g = new d.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', ranksep: 60, nodesep: 28, marginx: 20, marginy: 20 });

  for (const node of nodes) {
    g.setNode(node.id, { width: NODE_W, height: NODE_H });
  }
  for (const edge of edges) {
    g.setEdge(edge.from, edge.to);
  }

  d.layout(g);

  const positions = new Map<string, { x: number; y: number }>();
  for (const node of nodes) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const n = g.node(node.id) as any;
    if (n) positions.set(node.id, { x: (n.x as number) - NODE_W / 2, y: (n.y as number) - NODE_H / 2 });
  }
  return positions;
}

function toFlowNodes(
  graph: JsonGraph,
  positions: Map<string, { x: number; y: number }>,
): StateNodeType[] {
  return graph.nodes.map((n) => ({
    id:       n.id,
    type:     'stateNode' as const,
    position: positions.get(n.id) ?? { x: 0, y: 0 },
    data: {
      label:      n.label,
      kind:       n.kind,
      status:     n.status,
      isInitial:  n.isInitial,
      isTerminal: n.isTerminal,
    },
  }));
}

function toFlowEdges(graph: JsonGraph): Edge[] {
  return graph.edges.map((e) => {
    const sourceStatus = graph.nodes.find((n) => n.id === e.from)?.status;
    return {
      id:       e.id,
      source:   e.from,
      target:   e.to,
      label:    e.action,
      animated: sourceStatus === 'active',
      ...(e.hasGuard ? { style: { strokeDasharray: '5 3' } } : {}),
    };
  });
}

export function WorkflowGraph() {
  const { definition, snapshot } = useRunner();

  const graph = useMemo(
    () => JsonGraphExporter.export(definition, snapshot),
    [definition, snapshot],
  );

  const positions = useMemo(() => dagreLayout(graph.nodes, graph.edges), [graph]);

  const nodes: Node[] = useMemo(() => toFlowNodes(graph, positions), [graph, positions]);
  const edges: Edge[] = useMemo(() => toFlowEdges(graph), [graph]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      fitView
      fitViewOptions={{ padding: 0.25 }}
    >
      <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
