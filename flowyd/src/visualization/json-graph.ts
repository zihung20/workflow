import type { WorkflowDefinition, InstanceSnapshot } from '../types/index.js';
import { StateKind } from '../types/index.js';
import type { IExporter } from './exporter.js';

/**
 * A node in the serialised JSON graph, ready for use with D3.js, React Flow,
 * Cytoscape.js, or any `{ nodes, edges }` renderer.
 */
export interface JsonGraphNode {
  id: string;
  kind: string;
  label: string;
  /** Present only when a live snapshot is provided. */
  status?: string;
  /** `true` when this node is the workflow's initial state. */
  isInitial: boolean;
  /** `true` when this node is one of the workflow's terminal states. */
  isTerminal: boolean;
  /** ForkState targets (present when `kind === 'fork'`). */
  targets?: string[];
  /** JoinState prerequisite state IDs and mode (present when `kind === 'join'`). */
  join?: { requires: string[]; mode: string | number };
  /** Name of the external process (present when `kind === 'wait'`). */
  externalName?: string;
}

/**
 * A directed edge in the serialised JSON graph.
 */
export interface JsonGraphEdge {
  id: string;
  from: string;
  to: string;
  /** The action name that triggers this transition. */
  action: string;
  /** `true` when this transition has a guard attached. */
  hasGuard: boolean;
}

/**
 * The complete JSON graph representation of a workflow, optionally annotated
 * with live instance state.
 */
export interface JsonGraph {
  name: string;
  nodes: JsonGraphNode[];
  edges: JsonGraphEdge[];
  /** Workflow metadata. */
  meta: {
    initialStateId: string;
    terminalStateIds: string[];
    actionNames: string[];
    /** Present when a live snapshot is provided. */
    instance?: {
      instanceId: string;
      version: number;
      isTerminal: boolean;
    };
  };
}

/**
 * Converts a `WorkflowDefinition` into a plain, JSON-serialisable graph
 * object suitable for any `{ nodes, edges }` renderer.
 *
 * When an `InstanceSnapshot` is provided, each node's `status` field is
 * populated with the live `StateStatus` string, enabling visual overlays
 * without post-processing.
 */
export const JsonGraphExporter: IExporter<JsonGraph> = {
  export(definition: WorkflowDefinition, snapshot?: InstanceSnapshot): JsonGraph {
    const terminalSet = new Set(definition.terminalStateIds);

    const nodes: JsonGraphNode[] = [];
    for (const [id, state] of definition.states) {
      const node: JsonGraphNode = {
        id,
        kind: state.kind,
        label: state.label,
        isInitial: id === definition.initialStateId,
        isTerminal: terminalSet.has(id),
        ...(snapshot ? { status: snapshot.stateStatuses[id] ?? 'idle' } : {}),
      };

      switch (state.kind) {
        case StateKind.Fork:
          node.targets = [...state.targets];
          break;
        case StateKind.Join:
          node.join = { requires: [...state.requires], mode: state.mode };
          break;
        case StateKind.Wait:
          node.externalName = state.externalName;
          break;
      }

      nodes.push(node);
    }

    const edges: JsonGraphEdge[] = definition.transitions.map((t, i) => ({
      id: `${t.from}__${t.on}__${t.to}__${i}`,
      from: t.from,
      to: t.to,
      action: t.on,
      hasGuard: t.guard !== undefined,
    }));

    return {
      name: definition.name,
      nodes,
      edges,
      meta: {
        initialStateId: definition.initialStateId,
        terminalStateIds: [...definition.terminalStateIds],
        actionNames: [...definition.actionSchemas.keys()],
        ...(snapshot
          ? {
              instance: {
                instanceId: snapshot.instanceId,
                version: snapshot.version,
                isTerminal: snapshot.isTerminal,
              },
            }
          : {}),
      },
    };
  },
};
