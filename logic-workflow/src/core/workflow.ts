import type { WorkflowDefinition, ActionPayloadMap, InstanceSnapshot } from '../types/index.js';
import { StateStatus } from '../types/index.js';
import { WorkflowInstance } from './instance.js';

/**
 * An immutable, compiled workflow definition that acts as a factory for
 * `WorkflowInstance` objects.
 *
 * A single `Workflow` can power any number of independent concurrent
 * instances — one per SOP run, ticket, order, or approval request. The
 * definition itself is never mutated after `WorkflowBuilder.build()` returns.
 *
 * @template TActions - Map of action names to their validated payload types.
 *                      Inferred automatically from `WorkflowBuilder.defineAction()` calls.
 */
export class Workflow<TActions extends ActionPayloadMap> {
  /** @internal */
  constructor(private readonly definition: WorkflowDefinition) {}

  /**
   * Creates a fresh `WorkflowInstance` with the initial state active and no
   * history.
   *
   * @param instanceId - A caller-supplied unique identifier for this run
   *                     (e.g. a UUID, database primary key, or order number).
   *                     Used in snapshots and history entries for correlation.
   * @returns A new `WorkflowInstance<TActions>` ready for guard injection and dispatch.
   */
  createInstance(instanceId: string): WorkflowInstance<TActions> {
    const now = new Date().toISOString();

    const stateStatuses: Record<string, StateStatus> = {};
    for (const id of this.definition.states.keys()) {
      stateStatuses[id] = StateStatus.Idle;
    }
    stateStatuses[this.definition.initialStateId] = StateStatus.Active;

    const snapshot: InstanceSnapshot = {
      instanceId,
      workflowName: this.definition.name,
      version: 0,
      stateStatuses,
      isTerminal: false,
      history: [],
      createdAt: now,
      updatedAt: now,
    };

    return new WorkflowInstance<TActions>(this.definition, snapshot);
  }

  /**
   * Reconstructs a `WorkflowInstance` from a previously persisted snapshot.
   *
   * The snapshot must have been produced by `instance.getSnapshot()` on an
   * instance of the same workflow definition (matched by `workflowName`).
   * Guard injections are NOT restored — the service layer must call
   * `instance.injectGuard()` again after restoration.
   *
   * @param snapshot - The JSON object retrieved from your persistence layer.
   * @returns A `WorkflowInstance<TActions>` in the exact state captured by the snapshot.
   * @throws {Error} If the snapshot's `workflowName` does not match this definition.
   */
  restoreInstance(snapshot: InstanceSnapshot): WorkflowInstance<TActions> {
    if (snapshot.workflowName !== this.definition.name) {
      throw new Error(
        `Cannot restore snapshot: workflow name mismatch. ` +
        `Expected "${this.definition.name}", got "${snapshot.workflowName}"`,
      );
    }
    return new WorkflowInstance<TActions>(this.definition, structuredClone(snapshot));
  }

  /** Returns the underlying definition for use by visualisation exporters. */
  getDefinition(): WorkflowDefinition {
    return this.definition;
  }
}
