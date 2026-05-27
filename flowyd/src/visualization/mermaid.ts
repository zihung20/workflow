import type { WorkflowDefinition, InstanceSnapshot, AnyState } from '../types/index.js';
import { StateKind, StateStatus } from '../types/index.js';
import type { IExporter } from './exporter.js';

/**
 * Maps each `StateStatus` to a Mermaid state class name used for live-run
 * highlighting when a snapshot is provided.
 */
const STATUS_CLASS: Partial<Record<StateStatus, string>> = {
  [StateStatus.Active]: 'active',
  [StateStatus.Waiting]: 'waiting',
  [StateStatus.Completed]: 'completed',
};

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, '_');
}

function stateDeclarationLine(state: AnyState, label: string, sid: string): string {
  switch (state.kind) {
    case StateKind.Fork:
      return `  state ${sid} <<fork>>`;
    case StateKind.Join:
      return `  state ${sid} <<join>>`;
    case StateKind.Wait:
      return `  state "${label} [${state.externalName}]" as ${sid}`;
    case StateKind.Step:
      return `  ${sid} : ${label}`;
  }
}

/**
 * Returns a concise descriptive suffix appended to a state's label to
 * communicate its kind without a legend.
 */
function kindSuffix(kind: StateKind): string {
  switch (kind) {
    case StateKind.Fork:
    case StateKind.Join:
      return '';
    case StateKind.Wait:
      return ' ⤴';
    default:
      return '';
  }
}

/**
 * Converts a `WorkflowDefinition` into a Mermaid `stateDiagram-v2` string.
 *
 * When an `InstanceSnapshot` is provided, states are annotated with CSS
 * class names (`active`, `waiting`, `completed`) that can be styled in the
 * rendering environment.
 *
 * The output can be pasted directly into any Mermaid-compatible renderer
 * (GitHub markdown, Mermaid Live Editor, Obsidian, Notion, etc.). No
 * external dependency on the Mermaid library is required.
 *
 * @example
 * ```ts
 * const diagram = MermaidExporter.export(workflow.getDefinition(), instance.getSnapshot());
 * ```
 */
export const MermaidExporter: IExporter<string> = {
  export(definition: WorkflowDefinition, snapshot?: InstanceSnapshot): string {
    const lines: string[] = ['stateDiagram-v2'];

    // State declarations with labels
    for (const [id, state] of definition.states) {
      const sid = sanitizeId(id);
      const label = `${state.label}${kindSuffix(state.kind)}`;

      lines.push(stateDeclarationLine(state, label, sid));
    }

    lines.push('');

    // Initial state arrow
    lines.push(`  [*] --> ${sanitizeId(definition.initialStateId)}`);

    // All action-triggered transitions — includes fan-in edges to join states with their labels
    for (const t of definition.transitions) {
      const from = sanitizeId(t.from);
      const to = sanitizeId(t.to);
      lines.push(`  ${from} --> ${to} : ${t.on}`);
    }

    // ForkState fan-out arrows (no label — fork bar is self-explanatory)
    for (const [id, state] of definition.states) {
      if (state.kind === StateKind.Fork) {
        for (const target of state.targets) {
          lines.push(`  ${sanitizeId(id)} --> ${sanitizeId(target)}`);
        }
      }
    }

    // Terminal state arrows
    for (const id of definition.terminalStateIds) {
      lines.push(`  ${sanitizeId(id)} --> [*]`);
    }

    // Live status annotations when a snapshot is provided
    if (snapshot) {
      lines.push('');
      lines.push('  classDef active    fill:#3b82f6,color:#fff,stroke:#2563eb');
      lines.push('  classDef waiting   fill:#f59e0b,color:#fff,stroke:#d97706');
      lines.push('  classDef completed fill:#10b981,color:#fff,stroke:#059669');
      for (const [id, status] of Object.entries(snapshot.stateStatuses)) {
        const cls = STATUS_CLASS[status];
        if (cls) {
          lines.push(`  class ${sanitizeId(id)} ${cls}`);
        }
      }
    }

    return lines.join('\n');
  },
};
