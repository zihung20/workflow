import type { WorkflowDefinition, ActionPayloadMap, InstanceSnapshot } from '../types/index.js';
import { StateStatus } from '../types/index.js';
import { WorkflowInstance } from './instance.js';
import { typedFromEntries } from './utils.js';

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
 * @template TContext - Type of the instance context declared via
 *                      `WorkflowBuilder.setContext()`. Defaults to `unknown`.
 */
export class Workflow<
  TActions extends ActionPayloadMap,
  TContext = unknown,
  TStates extends string = string,
> {
  /** @internal */
  constructor(private readonly definition: WorkflowDefinition<TContext, TStates>) {}

  /**
   * Creates a fresh `WorkflowInstance` with the initial state active and no
   * history.
   *
   * @param instanceId - A caller-supplied unique identifier for this run
   *                     (e.g. a UUID, database primary key, or order number).
   *                     Used in snapshots and history entries for correlation.
   * @param context    - Initial context for this instance. **Required** when
   *                     `setContext()` was called on the builder (`TContext` is
   *                     concrete); omitted when no context schema was declared
   *                     (`TContext` is `unknown`).
   * @returns A new `WorkflowInstance<TActions, TContext>` ready for guard injection and dispatch.
   */
  createInstance(
    instanceId: string,
    ...args: unknown extends TContext ? [context?: TContext] : [context: TContext]
  ): WorkflowInstance<TActions, TContext, TStates> {
    const now = new Date().toISOString();

    const stateStatuses = new Map<TStates, StateStatus>();
    for (const id of this.definition.states.keys()) {
      stateStatuses.set(id, StateStatus.Idle);
    }
    stateStatuses.set(this.definition.initialStateId, StateStatus.Active);

    // Conditional rest params collapse to TContext | undefined at runtime; the
    // overload signature enforces presence when TContext is concrete.
    const context = (args as [TContext | undefined])[0];
    // contextSchema is ZodSchema<TContext>, so parse() returns TContext directly.
    const validatedContext =
      context !== undefined
        ? (this.definition.contextSchema?.parse(context) ?? context)
        : undefined;

    const snapshotBase: InstanceSnapshot<TContext, TStates> = {
      instanceId,
      workflowName: this.definition.name,
      version: 0,
      stateStatuses: typedFromEntries(stateStatuses),
      isTerminal: false,
      history: [],
      createdAt: now,
      updatedAt: now,
    };
    // Conditionally include context to satisfy exactOptionalPropertyTypes:
    // context?: TContext does not allow explicit `undefined` when TContext is concrete.
    const snapshot: InstanceSnapshot<TContext, TStates> =
      validatedContext !== undefined
        ? { ...snapshotBase, context: validatedContext }
        : snapshotBase;

    return new WorkflowInstance<TActions, TContext, TStates>(this.definition, snapshot);
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
   * @returns A `WorkflowInstance<TActions, TContext>` in the exact state captured by the snapshot.
   * @throws {Error} If the snapshot's `workflowName` does not match this definition.
   */
  restoreInstance(
    snapshot: InstanceSnapshot<TContext, TStates>,
  ): WorkflowInstance<TActions, TContext, TStates> {
    if (snapshot.workflowName !== this.definition.name) {
      throw new Error(
        `Cannot restore snapshot: workflow name mismatch. ` +
          `Expected "${this.definition.name}", got "${snapshot.workflowName}"`,
      );
    }
    return new WorkflowInstance<TActions, TContext, TStates>(
      this.definition,
      structuredClone(snapshot),
    );
  }

  /**
   * Returns the underlying definition for use by visualisation exporters.
   *
   * The return type is the type-erased `WorkflowDefinition<TContext>` (=
   * `WorkflowDefinition<TContext, string>`) because visualisation operates on
   * plain string state IDs and does not need the `TStates` literal union.
   */
  getDefinition(): WorkflowDefinition<TContext> {
    // Cast is safe: widening TStates to string; visualisation reads IDs as strings only.
    return this.definition;
  }
}
