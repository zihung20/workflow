import type {
  WorkflowDefinition,
  ActionPayloadMap,
  DispatchResult,
  HistoryEntry,
  InstanceSnapshot,
  ReadonlyInstanceState,
  GuardFn,
} from '../types/index.js';

/**
 * Produces `Base` intersected with `{ [extra keys in Given]: never }`.
 * Applied to `dispatch` / `canExecute` so that object literals with unknown
 * properties fail at the call site rather than silently reaching Zod's runtime
 * `.strict()` check.
 */
type Exact<Base, Given extends Base> = Given & { [K in Exclude<keyof Given, keyof Base>]: never };
import { StateStatus, StateKind } from '../types/index.js';
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
 * @template TContext - Type of the instance context declared via
 *                      `WorkflowBuilder.setContext()`. Defaults to `unknown`.
 */
export class WorkflowInstance<TActions extends ActionPayloadMap, TContext = unknown> {
  private readonly guardRegistry = new GuardRegistry();

  /** @internal Created exclusively by `Workflow._createInstance` and `Workflow._restoreInstance`. */
  constructor(
    private readonly definition: WorkflowDefinition<TContext>,
    private snapshot: InstanceSnapshot<TContext>,
  ) {}

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
  injectGuard<TPayload = unknown, TCtx = unknown>(name: string, fn: GuardFn<TPayload, TCtx>): this {
    this.guardRegistry.register(name, fn);
    return this;
  }

  // ─── Context ──────────────────────────────────────────────────────────────

  /**
   * Replaces the accumulated instance context and persists it in the snapshot.
   *
   * Guards declared on transitions can read this value via `ctx.context`.
   * The new value is immediately available to the next `dispatch` call and is
   * included in the snapshot returned by `getSnapshot()`.
   *
   * @param data - The new context value. Must conform to `TContext`.
   * @returns `this` for chaining.
   */
  setContext(data: TContext): this {
    // contextSchema is ZodSchema<TContext>, so parse() returns TContext directly.
    const validated = this.definition.contextSchema?.parse(data) ?? data;
    this.snapshot = { ...this.snapshot, context: validated };
    return this;
  }

  /**
   * Returns the current instance context.
   *
   * When `setContext()` was called on the builder, `createInstance()` requires
   * context to be provided, so this will never be `undefined` in practice for
   * typed workflows. For workflows with no declared context schema the return
   * type resolves to `unknown`, which subsumes `undefined`.
   *
   * @returns The context passed to `createInstance()` or last set via
   *          `setContext()`, or `undefined` if neither has been called.
   */
  getContext(): TContext | undefined {
    return this.snapshot.context;
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
      if (activeStates.has(t.from)) {
        actions.add(t.on);
      }
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
  async canExecute<K extends keyof TActions & string, P extends TActions[K]>(
    action: K,
    payload: Exact<TActions[K], P>,
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
  async dispatch<K extends keyof TActions & string, P extends TActions[K]>(
    action: K,
    payload: Exact<TActions[K], P>,
  ): Promise<DispatchResult<TContext>>;

  /**
   * @internal Overload used by `canExecute` to perform a dry-run without
   *           committing state changes.
   */
  async dispatch<K extends keyof TActions & string>(
    action: K,
    payload: TActions[K],
    dryRun: boolean,
  ): Promise<DispatchResult<TContext>>;

  async dispatch<K extends keyof TActions & string>(
    action: K,
    payload: TActions[K],
    dryRun = false,
  ): Promise<DispatchResult<TContext>> {
    const schema = this.definition.actionSchemas.get(action);
    if (!schema) {
      throw new Error(`Action "${action}" is not registered in workflow "${this.definition.name}"`);
    }

    const validatedPayload = schema.parse(payload);

    const result = await WorkflowEngine.dispatch(
      this.definition,
      this.buildReadonlyView(),
      this.guardRegistry,
      this.snapshot,
      action,
      validatedPayload,
      this.snapshot.context,
    );

    if (result.success && !dryRun) {
      this.snapshot = result.snapshot;
    }

    return result;
  }

  /**
   * Signals that an external process has completed, promoting the corresponding
   * `WaitState` from `waiting` to `active`.
   *
   * After calling this, dispatch the appropriate action to transition out of
   * the wait state (e.g. `instance.dispatch('KYC_PASSED', {})`).
   *
   * @param stateId          - ID of the `WaitState` to resolve.
   * @param externalSnapshot - Optional snapshot of the completed external process.
   *                           Stored in the history entry for auditability.
   * @throws {Error} If the state is not a `WaitState` or is not currently
   *                 in `waiting` status.
   */
  resolveWait(stateId: string, externalSnapshot?: InstanceSnapshot): void {
    const state = this.definition.states.get(stateId);
    if (!state || state.kind !== StateKind.Wait) {
      throw new Error(`State "${stateId}" is not a WaitState`);
    }

    const current = this.snapshot.stateStatuses[stateId];
    if (current !== StateStatus.Waiting) {
      throw new Error(
        `WaitState "${stateId}" is not waiting (current status: "${current ?? 'idle'}")`,
      );
    }

    const updatedStatuses = {
      ...this.snapshot.stateStatuses,
      [stateId]: StateStatus.Active,
    };

    const ctx = this.snapshot.context;
    const historyEntry: HistoryEntry<TContext> = {
      action: `__resolve_wait:${stateId}`,
      payload: externalSnapshot ?? null,
      exitedStates: [],
      enteredStates: [stateId],
      stateStatuses: updatedStatuses,
      at: new Date().toISOString(),
      ...(ctx !== undefined && { context: ctx }),
    };

    this.snapshot = {
      ...this.snapshot,
      version: this.snapshot.version + 1,
      stateStatuses: updatedStatuses,
      history: [...this.snapshot.history, historyEntry],
      updatedAt: historyEntry.at,
    };
  }

  /**
   * Returns a plain, JSON-serialisable snapshot of the current instance state.
   *
   * Safe to `JSON.stringify` and write to any persistence layer. The returned
   * object is a deep clone — mutations do not affect the live instance.
   *
   * @returns An `InstanceSnapshot<TContext>` capturing the full current state.
   */
  getSnapshot(): InstanceSnapshot<TContext> {
    return structuredClone(this.snapshot);
  }

  /**
   * Returns an independent deep-cloned snapshot of what the instance looked like
   * at the given version. Mutations to the returned object do not affect the live
   * instance.
   *
   * **Context accuracy**: each history entry records the context that was active
   * at the time of the corresponding dispatch, so `rewind(N).context` reflects
   * the exact context that guards saw when transitioning to version N. For
   * version 0, context reflects whatever was set before the first dispatch
   * (captured in `history[0].context`); if no dispatches have occurred yet,
   * the current context is used.
   *
   * @param version - An integer in `[0, currentVersion]`. `0` is the initial
   *                  state before any dispatches; passing the current version is
   *                  equivalent to calling `getSnapshot()`.
   * @returns A complete `InstanceSnapshot<TContext>` for the requested version.
   * @throws {Error} If `version` is outside `[0, currentVersion]`.
   * @throws {Error} If a required history entry has no `stateStatuses` record,
   *                 meaning the snapshot predates rewind support.
   */
  rewind(version: number): InstanceSnapshot<TContext> {
    const current = this.snapshot.version;
    if (version < 0 || version > current) {
      throw new Error(
        `Version ${version} is out of range. Expected a value between 0 and ${current}.`,
      );
    }

    if (version === current) {
      return this.getSnapshot();
    }

    if (version === 0) {
      const stateStatuses: Record<string, StateStatus> = {};
      for (const id of this.definition.states.keys()) {
        stateStatuses[id] = StateStatus.Idle;
      }
      stateStatuses[this.definition.initialStateId] = StateStatus.Active;

      // Use context from the first history entry if it exists (captures what was
      // set before the first dispatch), otherwise fall back to the current context.
      const contextAtV0 = this.snapshot.history[0]?.context ?? this.snapshot.context;

      const base: InstanceSnapshot<TContext> = {
        instanceId: this.snapshot.instanceId,
        workflowName: this.snapshot.workflowName,
        version: 0,
        stateStatuses,
        isTerminal: false,
        history: [],
        createdAt: this.snapshot.createdAt,
        updatedAt: this.snapshot.createdAt,
      };
      const result: InstanceSnapshot<TContext> =
        contextAtV0 !== undefined ? { ...base, context: contextAtV0 } : base;
      return structuredClone(result);
    }

    const entry = this.snapshot.history[version - 1];
    if (entry === undefined) {
      throw new Error(`Internal: no history entry at index ${version - 1}`);
    }
    const { stateStatuses } = entry;
    if (stateStatuses === undefined) {
      throw new Error(
        `Cannot rewind to version ${version}: history entry has no stateStatuses. ` +
          `The snapshot may predate rewind support.`,
      );
    }

    const isTerminal = this.definition.terminalStateIds.some(
      (id) => stateStatuses[id] === StateStatus.Active,
    );

    // Context at version N is what was in effect when dispatch N fired, recorded in
    // history[N-1].context. Falls back to current context for pre-rewind-support snapshots.
    const contextAtN = entry.context ?? this.snapshot.context;

    const base: InstanceSnapshot<TContext> = {
      instanceId: this.snapshot.instanceId,
      workflowName: this.snapshot.workflowName,
      version,
      stateStatuses,
      isTerminal,
      history: this.snapshot.history.slice(0, version),
      createdAt: this.snapshot.createdAt,
      updatedAt: entry.at,
    };
    const result: InstanceSnapshot<TContext> =
      contextAtN !== undefined ? { ...base, context: contextAtN } : base;
    return structuredClone(result);
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
        Object.entries(statuses)
          .filter(([, s]) => s === StateStatus.Active)
          .map(([id]) => id),
      getWaitingStates: () =>
        Object.entries(statuses)
          .filter(([, s]) => s === StateStatus.Waiting)
          .map(([id]) => id),
      getCompletedStates: () =>
        Object.entries(statuses)
          .filter(([, s]) => s === StateStatus.Completed)
          .map(([id]) => id),
      isStateCompleted: (id: string) => getStatus(id) === StateStatus.Completed,
      isStateActive: (id: string) => getStatus(id) === StateStatus.Active,
      isStateWaiting: (id: string) => getStatus(id) === StateStatus.Waiting,
    };
  }
}
