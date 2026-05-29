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
import { typedEntries } from './utils.js';

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
export class WorkflowInstance<TActions extends ActionPayloadMap, TContext = unknown, TStates extends string = string> {
  private readonly guardRegistry = new GuardRegistry();

  /** @internal Created exclusively by `Workflow._createInstance` and `Workflow._restoreInstance`. */
  constructor(
    private readonly definition: WorkflowDefinition<TContext, TStates>,
    private snapshot: InstanceSnapshot<TContext, TStates>,
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
  injectGuard<TPayload = unknown, TCtx = unknown>(name: string, fn: GuardFn<TPayload, TCtx, TStates>): this {
    // Registry is type-erased (GuardFn<unknown>); TStates is asserted correct by construction.
    this.guardRegistry.register(name, fn as GuardFn<TPayload, TCtx>);
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
  getCurrentStates(): TStates[] {
    // Cast is safe: stateStatuses keys are exclusively registered state IDs, which are TStates by construction.
    return Object.entries(this.snapshot.stateStatuses)
      .filter(([, s]) => s === StateStatus.Active || s === StateStatus.Waiting)
      .map(([id]) => id) as TStates[];
  }

  /**
   * Returns the `StateStatus` of the given state at the time of this call.
   *
   * @param stateId - A state ID registered in the workflow definition.
   * @throws {Error} If no state with this ID exists in the definition.
   */
  getStateStatus(stateId: TStates): StateStatus {
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
  getAvailableTransitions(): (keyof TActions & string)[] {
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
    // Cast is safe: transition.on values are registered via addTransition, which constrains
    // them to keyof TActions & string at the builder level.
    return [...actions] as (keyof TActions & string)[];
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
  ): Promise<DispatchResult<TContext, TStates, K>>;

  /**
   * @internal Overload used by `canExecute` to perform a dry-run without
   *           committing state changes.
   */
  async dispatch<K extends keyof TActions & string>(
    action: K,
    payload: TActions[K],
    dryRun: boolean,
  ): Promise<DispatchResult<TContext, TStates, K>>;

  async dispatch<K extends keyof TActions & string>(
    action: K,
    payload: TActions[K],
    dryRun = false,
  ): Promise<DispatchResult<TContext, TStates, K>> {
    const schema = this.definition.actionSchemas.get(action);
    if (!schema) {
      throw new Error(`Action "${action}" is not registered in workflow "${this.definition.name}"`);
    }

    const validatedPayload = schema.parse(payload);

    const result = await WorkflowEngine.dispatch<TContext, TStates, K>(
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
  resolveWait(stateId: TStates, externalSnapshot?: InstanceSnapshot): void {
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

    // Cast is safe: spreading Record<TStates, StateStatus> and overwriting one TStates key.
    const updatedStatuses = {
      ...this.snapshot.stateStatuses,
      [stateId]: StateStatus.Active,
    } as Readonly<Record<TStates, StateStatus>>;

    const ctx = this.snapshot.context;
    const historyEntry: HistoryEntry<TContext, TStates> = {
      action: `__resolve_wait:${stateId}`,
      payload: externalSnapshot ?? null,
      exitedStates: [],
      enteredStates: [stateId],
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
  getSnapshot(): InstanceSnapshot<TContext, TStates> {
    return structuredClone(this.snapshot);
  }

  /**
   * Returns an independent deep-cloned snapshot of what the instance looked like
   * at the given version. Mutations to the returned object do not affect the live
   * instance.
   *
   * Reconstructs state by replaying the `exitedStates`/`enteredStates` deltas
   * from every history entry up to `version`. Cost is O(version) — acceptable
   * for a debugging or audit tool that is never called in a hot path.
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
   */
  rewind(version: number): InstanceSnapshot<TContext, TStates> {
    const current = this.snapshot.version;
    if (version < 0 || version > current) {
      throw new Error(
        `Version ${version} is out of range. Expected a value between 0 and ${current}.`,
      );
    }

    if (version === current) {
      return this.getSnapshot();
    }

    // Build the initial status map: every state idle, initial state active.
    const stateStatuses: Record<string, StateStatus> = {};
    for (const id of this.definition.states.keys()) {
      stateStatuses[id] = StateStatus.Idle;
    }
    stateStatuses[this.definition.initialStateId] = StateStatus.Active;

    // Cast is safe: stateStatuses is populated exclusively from registered state IDs,
    // all of which are members of TStates by construction.
    const typedStatuses = stateStatuses as Readonly<Record<TStates, StateStatus>>;

    if (version === 0) {
      // Use context from the first history entry if it exists (captures what was
      // set before the first dispatch), otherwise fall back to the current context.
      const contextAtV0 = this.snapshot.history[0]?.context ?? this.snapshot.context;
      const base: InstanceSnapshot<TContext, TStates> = {
        instanceId: this.snapshot.instanceId,
        workflowName: this.snapshot.workflowName,
        version: 0,
        stateStatuses: typedStatuses,
        isTerminal: false,
        history: [],
        createdAt: this.snapshot.createdAt,
        updatedAt: this.snapshot.createdAt,
      };
      const result: InstanceSnapshot<TContext, TStates> =
        contextAtV0 !== undefined ? { ...base, context: contextAtV0 } : base;
      return structuredClone(result);
    }

    // Replay the exitedStates/enteredStates deltas from each history entry in order.
    // resolveWait promotes a WaitState from Waiting → Active; all other entries derive
    // the entered status from the state's kind.
    for (const entry of this.snapshot.history.slice(0, version)) {
      for (const id of entry.exitedStates) {
        stateStatuses[id] = StateStatus.Completed;
      }
      for (const id of entry.enteredStates) {
        const isResolveWait = entry.action.startsWith('__resolve_wait:');
        const state = this.definition.states.get(id);
        stateStatuses[id] =
          !isResolveWait && state?.kind === StateKind.Wait
            ? StateStatus.Waiting
            : StateStatus.Active;
      }
    }

    const isTerminal = this.definition.terminalStateIds.some(
      (id) => stateStatuses[id] === StateStatus.Active,
    );

    const entry = this.snapshot.history[version - 1]!;
    // Context at version N is what was in effect when dispatch N fired, recorded in history[N-1].context.
    const contextAtN = entry.context ?? this.snapshot.context;

    const base: InstanceSnapshot<TContext, TStates> = {
      instanceId: this.snapshot.instanceId,
      workflowName: this.snapshot.workflowName,
      version,
      stateStatuses: typedStatuses,
      isTerminal,
      history: this.snapshot.history.slice(0, version),
      createdAt: this.snapshot.createdAt,
      updatedAt: entry.at,
    };
    const result: InstanceSnapshot<TContext, TStates> =
      contextAtN !== undefined ? { ...base, context: contextAtN } : base;
    return structuredClone(result);
  }

  // ─── Internal helpers ─────────────────────────────────────────────────────

  /**
   * Constructs the `ReadonlyInstanceState` view passed to the engine and guards.
   * This view reflects the state at the time of each `dispatch` call.
   */
  private buildReadonlyView(): ReadonlyInstanceState<TStates> {
    const statuses = this.snapshot.stateStatuses;
    const instanceId = this.snapshot.instanceId;
    const workflowName = this.snapshot.workflowName;

    // stateStatuses is Record<TStates, StateStatus> — keyed access returns StateStatus | undefined
    // under noUncheckedIndexedAccess for dynamic (string) TStates, hence the ?? fallback.
    const getStatus = (id: TStates): StateStatus => statuses[id] ?? StateStatus.Idle;

    return {
      instanceId,
      workflowName,
      getStateStatus: getStatus,
      getActiveStates: () =>
        typedEntries(statuses)
          .filter(([, s]) => s === StateStatus.Active)
          .map(([id]) => id),
      getWaitingStates: () =>
        typedEntries(statuses)
          .filter(([, s]) => s === StateStatus.Waiting)
          .map(([id]) => id),
      getCompletedStates: () =>
        typedEntries(statuses)
          .filter(([, s]) => s === StateStatus.Completed)
          .map(([id]) => id),
      isStateCompleted: (id: TStates) => getStatus(id) === StateStatus.Completed,
      isStateActive: (id: TStates) => getStatus(id) === StateStatus.Active,
      isStateWaiting: (id: TStates) => getStatus(id) === StateStatus.Waiting,
    };
  }
}
