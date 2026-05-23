import type {
  WorkflowDefinition,
  ActionPayloadMap,
  DispatchResult,
  InstanceSnapshot,
  ReadonlyInstanceState,
  GuardFn,
} from '../types/index.js';
import { StateStatus, StateKind } from '../types/index.js';
import type { ISubWorkflowState } from '../types/index.js';
import { GuardRegistry } from './registry.js';
import { WorkflowEngine } from './engine.js';

/**
 * Mutable runtime state for a single SOP execution.
 *
 * A `WorkflowInstance` is always created from an immutable `Workflow`
 * definition via `workflow.createInstance(id)` or restored from a persisted
 * snapshot via `workflow.restoreInstance(snapshot)`. Each instance is
 * completely independent — concurrent executions of the same workflow
 * definition share no state.
 *
 * **Persistence pattern**
 * After every `dispatch`, call `instance.getSnapshot()` and write the result
 * to your database. To resume, load the JSON and pass it to
 * `workflow.restoreInstance(snapshot)`. Guard injections are not part of the
 * snapshot and must be re-applied after restoration.
 *
 * @template TActions - Map of action names to their validated payload types,
 *                      inferred from `WorkflowBuilder.defineAction()` calls.
 */
export class WorkflowInstance<TActions extends ActionPayloadMap> {
  private snapshot: InstanceSnapshot;
  private readonly guardRegistry = new GuardRegistry();

  /** @internal Created exclusively by `Workflow._createInstance` and `Workflow._restoreInstance`. */
  constructor(
    private readonly definition: WorkflowDefinition,
    snapshot: InstanceSnapshot, //TODO: making inline private
  ) {
    this.snapshot = snapshot;
  }

  // ─── Guard injection ──────────────────────────────────────────────────────

  /**
   * Registers a named guard function for use by `Guard.inject('name')`
   * placeholders declared in the workflow definition.
   *
   * Returns `this` for chaining. Calling `injectGuard` with the same name
   * twice replaces the previous implementation.
   *
   * @param name - Must match the name used in `Guard.inject('name')`.
   * @param fn   - The guard implementation. Annotate `TPayload` to match the
   *               payload type of the action(s) this guard is attached to.
   */
  injectGuard<TPayload = unknown>(name: string, fn: GuardFn<TPayload>): this {
    this.guardRegistry.register(name, fn);
    return this;
  }

  // ─── Query ────────────────────────────────────────────────────────────────

  /**
   * Returns the IDs of all states currently in `active` or `waiting` status.
   * `waiting` states are included because they represent steps the workflow
   * is currently "at" (blocked on an external process).
   */
  getCurrentStates(): string[] {
    return Object.entries(this.snapshot.stateStatuses)
      .filter(([, s]) => s === StateStatus.Active || s === StateStatus.Waiting)
      .map(([id]) => id);
  }

  /**
   * Returns the `StateStatus` of the given state at the time of this call.
   *
   * @param stateId - A state ID registered in the workflow definition.
   * @throws {Error} If no state with this ID exists in the definition.
   */
  getStateStatus(stateId: string): StateStatus {
    if (!this.definition.states.has(stateId)) {
      throw new Error(`State "${stateId}" is not registered in workflow "${this.definition.name}"`);
    }
    return this.snapshot.stateStatuses[stateId] ?? StateStatus.Idle;
  }

  /** `true` if the workflow has reached any terminal state and can accept no further dispatches. */
  isTerminal(): boolean {
    return this.snapshot.isTerminal;
  }

  /**
   * Returns the action names for which at least one transition exists from
   * a currently `active` state, **without evaluating guards**.
   *
   * Use this for UI affordances (e.g. which buttons to show). Use
   * `canExecute` to check whether the guard will actually pass.
   */
  getAvailableTransitions(): string[] {
    const activeStates = new Set(
      Object.entries(this.snapshot.stateStatuses)
        .filter(([, s]) => s === StateStatus.Active)
        .map(([id]) => id),
    );

    const actions = new Set<string>();
    for (const t of this.definition.transitions) {
      if (activeStates.has(t.from)) actions.add(t.on);
    }
    return [...actions];
  }

  /**
   * Evaluates whether the given action can fire right now — including guard
   * evaluation with the provided payload.
   *
   * @param action  - The action to test.
   * @param payload - The payload that would be passed to `dispatch`.
   * @returns `true` if at least one matching transition passes its guard.
   */
  async canExecute<K extends keyof TActions & string>(
    action: K,
    payload: TActions[K],
  ): Promise<boolean> {
    const result = await this.dispatch(action, payload, true);
    return result.success;
  }

  // ─── Advance ──────────────────────────────────────────────────────────────

  /**
   * Dispatches an action against the current instance state.
   *
   * The engine validates the payload, evaluates all matching transitions and
   * their guards, applies the resulting state changes atomically, and returns
   * a `DispatchResult`. On success the internal snapshot is updated —
   * call `getSnapshot()` immediately after to capture the new state for
   * persistence.
   *
   * @param action  - An action name declared via `WorkflowBuilder.defineAction()`.
   * @param payload - The typed payload for this action, validated against the
   *                  action's Zod schema before any guard is evaluated.
   * @returns A discriminated `DispatchResult` — check `result.success` to
   *          distinguish a successful transition from a blocked one.
   * @throws {Error}    If the action name has no registered schema.
   * @throws {ZodError} If `payload` fails schema validation.
   * @throws {Error}    If a named guard referenced by the transition has not
   *                    been injected via `injectGuard()`.
   */
  async dispatch<K extends keyof TActions & string>(
    action: K,
    payload: TActions[K],
  ): Promise<DispatchResult>;

  /**
   * @internal Overload used by `canExecute` to perform a dry-run without
   *           committing state changes.
   */
  async dispatch<K extends keyof TActions & string>(
    action: K,
    payload: TActions[K],
    dryRun: boolean,
  ): Promise<DispatchResult>;

  async dispatch<K extends keyof TActions & string>(
    action: K,
    payload: TActions[K],
    dryRun = false,
  ): Promise<DispatchResult> {
    const schema = this.definition.actionSchemas.get(action);
    if (!schema) throw new Error(`Action "${action}" is not registered in workflow "${this.definition.name}"`);

    const validatedPayload = schema.parse(payload);

    const result = await WorkflowEngine.dispatch(
      this.definition,
      this.buildReadonlyView(),
      this.guardRegistry,
      this.snapshot,
      action,
      validatedPayload,
    );

    if (result.success && !dryRun) {
      this.snapshot = result.snapshot;
    }

    return result;
  }

  // ─── Sub-workflow resolution ───────────────────────────────────────────────

  /**
   * Signals that an external sub-workflow has completed, promoting the
   * corresponding `SubWorkflowState` from `waiting` to `active`.
   *
   * After calling this, dispatch the appropriate action to transition out of
   * the sub-workflow state (e.g. `instance.dispatch('KYC_PASSED', {})`).
   *
   * @param stateId          - ID of the `SubWorkflowState` to resolve.
   * @param externalSnapshot - Optional snapshot of the completed sub-workflow
   *                           instance. Stored in the history entry for
   *                           auditability.
   * @throws {Error} If the state is not a `SubWorkflowState` or is not
   *                 currently in `waiting` status.
   */
  resolveSubWorkflow(stateId: string, externalSnapshot?: InstanceSnapshot): void {
    const state = this.definition.states.get(stateId);
    if (!state || state.kind !== StateKind.SubWorkflow) {
      throw new Error(`State "${stateId}" is not a SubWorkflowState`);
    }

    const current = this.snapshot.stateStatuses[stateId];
    if (current !== StateStatus.Waiting) {
      throw new Error(
        `SubWorkflowState "${stateId}" is not waiting (current status: "${current ?? 'idle'}")`,
      );
    }

    const updatedStatuses = {
      ...this.snapshot.stateStatuses,
      [stateId]: StateStatus.Active,
    };

    const historyEntry = {
      action: `__resolve_sub_workflow:${stateId}`,
      payload: externalSnapshot ?? null,
      exitedStates: [] as string[],
      enteredStates: [stateId],
      at: new Date().toISOString(),
    };

    this.snapshot = {
      ...this.snapshot,
      version: this.snapshot.version + 1,
      stateStatuses: updatedStatuses,
      history: [...this.snapshot.history, historyEntry],
      updatedAt: historyEntry.at,
    };

    // Suppress unused variable warning — stored for documentation purposes
    void (state as ISubWorkflowState).subWorkflowName;
  }

  // ─── Persistence ──────────────────────────────────────────────────────────

  /**
   * Returns a plain, JSON-serialisable snapshot of the current instance state.
   *
   * Safe to `JSON.stringify` and write to any persistence layer. The returned
   * object is a deep-frozen copy — mutations do not affect the live instance.
   *
   * @returns An `InstanceSnapshot` capturing the full current state.
   */
  getSnapshot(): InstanceSnapshot {
    return structuredClone(this.snapshot);
  }

  // ─── Internal helpers ─────────────────────────────────────────────────────

  /**
   * Constructs the `ReadonlyInstanceState` view passed to the engine and guards.
   * This view reflects the state at the time of each `dispatch` call.
   */
  private buildReadonlyView(): ReadonlyInstanceState {
    const statuses = this.snapshot.stateStatuses;
    const instanceId = this.snapshot.instanceId;
    const workflowName = this.snapshot.workflowName;

    const getStatus = (id: string): StateStatus => statuses[id] ?? StateStatus.Idle;

    return {
      instanceId,
      workflowName,
      getStateStatus: getStatus,
      getActiveStates: () =>
        Object.entries(statuses).filter(([, s]) => s === StateStatus.Active).map(([id]) => id),
      getWaitingStates: () =>
        Object.entries(statuses).filter(([, s]) => s === StateStatus.Waiting).map(([id]) => id),
      getCompletedStates: () =>
        Object.entries(statuses).filter(([, s]) => s === StateStatus.Completed).map(([id]) => id),
      isStateCompleted: (id: string) => getStatus(id) === StateStatus.Completed,
      isStateActive: (id: string) => getStatus(id) === StateStatus.Active,
      isStateWaiting: (id: string) => getStatus(id) === StateStatus.Waiting,
    };
  }
}
