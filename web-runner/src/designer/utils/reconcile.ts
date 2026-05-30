import type { WorkflowDefinition } from 'flowyd';
import type { DesignerWorkflow, DesignerNode, DesignerEdge } from '../types';

/**
 * Build a DesignerWorkflow from a compiled WorkflowDefinition, preserving
 * any guard bodies that were hand-written by the user in the code editor.
 */
export function reconcile(current: DesignerWorkflow, definition: WorkflowDefinition): DesignerWorkflow {
  const guardBodies = new Map<string, string>();
  for (const edge of current.edges) {
    if (edge.kind === 'transition' && edge.guardBody) {
      guardBodies.set(`${edge.fromNodeId}--${edge.actionName}`, edge.guardBody);
    }
  }

  const nodes: DesignerNode[] = [];
  for (const [id, state] of definition.states) {
    const fork = state.kind === 'fork' ? (state as unknown as { targets: readonly string[] }) : null;
    const join = state.kind === 'join'
      ? (state as unknown as { requires: readonly string[]; mode: 'all' | 'any' | number })
      : null;
    const wait = state.kind === 'wait' ? (state as unknown as { externalName: string }) : null;

    nodes.push({
      id,
      kind: state.kind as DesignerNode['kind'],
      label: state.label,
      isInitial: id === definition.initialStateId,
      isTerminal: definition.terminalStateIds.includes(id),
      forkTargets: fork ? [...fork.targets] : [],
      joinRequires: join ? [...join.requires] : [],
      joinMode: join ? join.mode : 'all',
      waitExternalName: wait ? wait.externalName : '',
    });
  }

  const edges: DesignerEdge[] = definition.transitions.map(t => ({
    id: `e-${t.from}-${t.on}-${t.to}`,
    fromNodeId: t.from,
    toNodeId: t.to,
    kind: 'transition' as const,
    actionName: t.on,
    guardBody: guardBodies.get(`${t.from}--${t.on}`) ?? '',
  }));

  for (const [id, state] of definition.states) {
    if (state.kind === 'fork') {
      const fork = state as unknown as { targets: readonly string[] };
      for (const target of fork.targets) {
        edges.push({
          id: `e-fork-${id}-${target}`,
          fromNodeId: id,
          toNodeId: target,
          kind: 'fork-target',
          actionName: '',
          guardBody: '',
        });
      }
    }
  }

  return { name: definition.name, nodes, edges };
}
