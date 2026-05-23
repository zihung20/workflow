import type { WorkflowDefinition, InstanceSnapshot } from '../types/index.js';
import { StateKind, StateStatus } from '../types/index.js';
import type { IForkState, IJoinState, ISubWorkflowState } from '../types/index.js';
import type { IExporter } from './exporter.js';

/**
 * Maps each `StateStatus` to a Mermaid state class name used for live-run
 * highlighting when a snapshot is provided.
 */
const STATUS_CLASS: Partial<Record<StateStatus, string>> = {
  [StateStatus.Active]:    'active',
  [StateStatus.Waiting]:   'waiting',
  [StateStatus.Completed]: 'completed',
};

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, '_');
}

/**
 * Returns a concise descriptive suffix appended to a state's label to
 * communicate its kind without a legend.
 */
function kindSuffix(kind: StateKind): string {
  switch (kind) {
    case StateKind.Fork:        return ' ⑂';
    case StateKind.Join:        return ' ⑁';
    case StateKind.SubWorkflow: return ' ⤴';
    default:                    return '';
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

      if (state.kind === StateKind.Fork || state.kind === StateKind.Join) {
        lines.push(`  state "${label}" as ${sid}`);
        if (state.kind === StateKind.Fork) {
          lines.push(`  [*] --> ${sid} : fork`);
        }
      } else if (state.kind === StateKind.SubWorkflow) {
        const sub = state as ISubWorkflowState;
        lines.push(`  state "${label} [${sub.subWorkflowName}]" as ${sid}`);
      } else {
        lines.push(`  ${sid} : ${label}`);
      }
    }

    lines.push('');

    // Initial state arrow
    lines.push(`  [*] --> ${sanitizeId(definition.initialStateId)}`);

    // Transitions
    for (const t of definition.transitions) {
      const from = sanitizeId(t.from);
      const to   = sanitizeId(t.to);
      lines.push(`  ${from} --> ${to} : ${t.on}`);
    }

    // ForkState fan-out arrows (informational, shown separately)
    for (const [id, state] of definition.states) {
      if (state.kind === StateKind.Fork) {
        const fork = state as IForkState;
        for (const target of fork.targets) {
          lines.push(`  ${sanitizeId(id)} --> ${sanitizeId(target)}`);
        }
      }
    }

    // JoinState required-inputs annotations
    for (const [id, state] of definition.states) {
      if (state.kind === StateKind.Join) {
        const join = state as IJoinState;
        for (const req of join.requires) {
          lines.push(`  ${sanitizeId(req)} --> ${sanitizeId(id)} : ✓`);
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
      for (const [id, status] of Object.entries(snapshot.stateStatuses)) {
        const cls = STATUS_CLASS[status as StateStatus];
        if (cls) lines.push(`  class ${sanitizeId(id)} ${cls}`);
      }
    }

    return lines.join('\n');
  },
};
