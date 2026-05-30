import type { DesignerWorkflow, DesignerNode, DesignerEdge } from '../types';

function topoSort(nodes: DesignerNode[], edges: DesignerEdge[]): DesignerNode[] {
  const deps = new Map<string, Set<string>>();
  for (const node of nodes) deps.set(node.id, new Set());

  for (const node of nodes) {
    if (node.kind === 'fork') {
      for (const t of node.forkTargets) deps.get(node.id)?.add(t);
    }
    if (node.kind === 'join') {
      for (const r of node.joinRequires) deps.get(node.id)?.add(r);
    }
  }

  const forkTargetEdges = edges.filter(e => e.kind === 'fork-target');
  for (const edge of forkTargetEdges) {
    deps.get(edge.fromNodeId)?.add(edge.toNodeId);
  }

  const sorted: DesignerNode[] = [];
  const visited = new Set<string>();

  function visit(id: string): void {
    if (visited.has(id)) return;
    visited.add(id);
    for (const dep of deps.get(id) ?? []) visit(dep);
    const node = nodes.find(n => n.id === id);
    if (node) sorted.unshift(node);
  }

  for (const node of nodes) visit(node.id);
  return sorted;
}

function indent(line: string): string {
  return `  ${line}`;
}

export function generateCode(wf: DesignerWorkflow): string {
  const { name, nodes, edges } = wf;
  const sortedNodes = topoSort(nodes, edges);

  const transitionEdges = edges.filter(e => e.kind === 'transition');

  const actionNames = [
    ...new Set(transitionEdges.map(e => e.actionName).filter(a => a.trim() !== '')),
  ];

  const initialNode = nodes.find(n => n.isInitial);
  const terminalNodes = nodes.filter(n => n.isTerminal);

  const forkTargetMap = new Map<string, string[]>();
  for (const edge of edges.filter(e => e.kind === 'fork-target')) {
    const arr = forkTargetMap.get(edge.fromNodeId) ?? [];
    arr.push(edge.toNodeId);
    forkTargetMap.set(edge.fromNodeId, arr);
  }

  const lines: string[] = [
    `import { createWorkflow } from 'flowyd';`,
    `import { z } from 'zod';`,
    ``,
  ];

  for (const action of actionNames) {
    lines.push(`const ${action}Schema = z.object({});`);
  }

  if (actionNames.length > 0) lines.push(``);

  lines.push(`const workflow = createWorkflow({ name: ${JSON.stringify(name)} })`);

  for (const action of actionNames) {
    lines.push(indent(`.defineAction('${action}', ${action}Schema)`));
  }

  for (const node of sortedNodes) {
    if (node.kind === 'step') {
      lines.push(indent(`.addStep('${node.id}', { label: ${JSON.stringify(node.label)} })`));
    } else if (node.kind === 'fork') {
      const targets = forkTargetMap.get(node.id) ?? node.forkTargets;
      const targetsStr = targets.map(t => `'${t}'`).join(', ');
      lines.push(indent(`.addFork('${node.id}', { label: ${JSON.stringify(node.label)}, targets: [${targetsStr}] })`));
    } else if (node.kind === 'join') {
      const requires = node.joinRequires;
      const requiresStr = requires.map(r => `'${r}'`).join(', ');
      const modeStr = typeof node.joinMode === 'number'
        ? String(node.joinMode)
        : `'${node.joinMode}'`;
      lines.push(indent(`.addJoin('${node.id}', { label: ${JSON.stringify(node.label)}, requires: [${requiresStr}], mode: ${modeStr} })`));
    } else if (node.kind === 'wait') {
      const ext = node.waitExternalName || node.id;
      lines.push(indent(`.addWait('${node.id}', { label: ${JSON.stringify(node.label)}, externalName: ${JSON.stringify(ext)} })`));
    }
  }

  if (initialNode) {
    lines.push(indent(`.setInitial('${initialNode.id}')`));
  }

  if (terminalNodes.length === 1) {
    lines.push(indent(`.setTerminal('${terminalNodes[0]!.id}')`));
  } else if (terminalNodes.length > 1) {
    const ids = terminalNodes.map(t => `'${t.id}'`).join(', ');
    lines.push(indent(`.setTerminal([${ids}])`));
  }

  for (const edge of transitionEdges) {
    if (!edge.actionName.trim()) continue;
    const hasGuard = edge.guardBody.trim() !== '';
    if (hasGuard) {
      lines.push(indent(`.addTransition({ from: '${edge.fromNodeId}', to: '${edge.toNodeId}', on: '${edge.actionName}',`));
      lines.push(indent(`  guard: (ctx) => { ${edge.guardBody} } })`));
    } else {
      lines.push(indent(`.addTransition({ from: '${edge.fromNodeId}', to: '${edge.toNodeId}', on: '${edge.actionName}' })`));
    }
  }

  lines.push(indent(`.build();`));

  return lines.join('\n');
}

export const DEFAULT_WORKFLOW: DesignerWorkflow = {
  name: 'my-workflow',
  nodes: [
    {
      id: 'start', kind: 'step', label: 'Start',
      isInitial: true, isTerminal: false,
      forkTargets: [], joinRequires: [], joinMode: 'all', waitExternalName: '',
    },
    {
      id: 'end', kind: 'step', label: 'End',
      isInitial: false, isTerminal: true,
      forkTargets: [], joinRequires: [], joinMode: 'all', waitExternalName: '',
    },
  ],
  edges: [
    { id: 'e-start-end', fromNodeId: 'start', toNodeId: 'end', kind: 'transition', actionName: 'COMPLETE', guardBody: '' },
  ],
};
