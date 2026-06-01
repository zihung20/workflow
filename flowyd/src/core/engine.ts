import type {
  WorkflowDefinition,
  TransitionDefinition,
  GuardContext,
  ReadonlyInstanceState,
  DispatchResult,
  HistoryEntry,
  InstanceSnapshot,
  IJoinState,
} from '../types/index.js';
import { StateKind, StateStatus } from '../types/index.js';
import type { GuardRegistry } from './registry.js';
import { typedEntries, typedFromEntries } from './utils.js';

/**
 * Intermediate, mutable state map computed during a single engine evaluation.
 * Never exposed outside this module.
 */
type MutableStatusMap<TStates extends string = string> = Map<TStates, StateStatus>;

/**
 * Result of a single engine evaluation cycle, before it is committed to the
 * instance.
 */
interface EvaluationResult<TStates extends string = string> {
  readonly newStatuses: MutableStatusMap<TStates>;
  readonly enteredStates: TStates[];
  readonly exitedStates: TStates[];
}

/**
 * Pure, stateless engine that evaluates a dispatched action against the
 * current instance state and computes the resulting state changes.
 *
 * The engine never mutates the instance directly — it returns a new
 * `DispatchResult` (including an updated snapshot on success) that
 * `WorkflowInstance` applies atomically. This separation means the engine
 * is trivially unit-testable and can be exercised with any state snapshot.
 */
export class WorkflowEngine {
  /**
   * Evaluates a dispatched action against the current instance state.
   *
   * `TContext` is inferred from `currentSnapshot`, `TStates` from `definition`,
   * and `TAction` from `action` so the returned `DispatchResult` is fully typed
   * at the call site — no cast required in `WorkflowInstance.dispatch`.
   *
   * @param definition      - The immutable compiled workflow graph.
   * @param instanceState   - Read-only view of the current instance state.
   * @param guardRegistry   - The instance's registered guard functions.
   * @param currentSnapshot - Full snapshot used to produce the updated one on success.
   * @param action          - The action name being dispatched.
   * @param payload         - The Zod-validated action payload.
   * @param context         - The accumulated instance context, passed through to guards.
   * @returns A `DispatchResult<TContext, TStates, TAction>` discriminated union. On success,
   *          includes the updated snapshot and lists of entered/exited states.
   * @throws Any error thrown by a guard's `evaluate()` method — guard errors
   *         are not caught by the engine and propagate directly to the caller.
   */
  static async dispatch<TContext, TStates extends string = string, TAction extends string = string>(
    definition: WorkflowDefinition<TContext, TStates>,
    instanceState: ReadonlyInstanceState<TStates>,
    guardRegistry: GuardRegistry,
    currentSnapshot: InstanceSnapshot<TContext, TStates>,
    action: TAction,
    payload: unknown,
    context: TContext | undefined,
  ): Promise<DispatchResult<TContext, TStates, TAction>> {
    if (currentSnapshot.isTerminal) {
      return {
        success: false,
        action,
        reason: 'terminal-state',
        activeStates: instanceState.getActiveStates().slice(),
      };
    }

    const candidates = definition.transitions.filter(
      (t) => t.on === action && instanceState.isStateActive(t.from),
    );

    if (candidates.length === 0) {
      const anyMatchesAction = definition.transitions.some((t) => t.on === action);
      return {
        success: false,
        action,
        reason: anyMatchesAction ? 'no-active-source' : 'invalid-action',
        activeStates: instanceState.getActiveStates().slice(),
      };
    }

    const guardCtx = WorkflowEngine.buildGuardContext(
      payload,
      instanceState,
      guardRegistry,
      context,
    );
    const passing: TransitionDefinition<TStates>[] = [];

    for (const candidate of candidates) {
      // Cast is safe: IGuard.evaluate is the type-erased guard boundary;
      // FnGuard re-narrows to the concrete payload/context/state types via its own cast.
      const allowed = candidate.guard
        ? await candidate.guard.evaluate(guardCtx)
        : true;
      if (allowed) {
        passing.push(candidate);
      }
    }

    if (passing.length === 0) {
      return {
        success: false,
        action,
        reason: 'guard-failed',
        activeStates: instanceState.getActiveStates().slice(),
      };
    }

    const result = WorkflowEngine.computeTransitions(
      passing,
      definition,
      currentSnapshot.stateStatuses,
    );

    const isTerminal = definition.terminalStateIds.some(
      (id) => result.newStatuses.get(id) === StateStatus.Active,
    );

    const updatedStatuses = typedFromEntries(result.newStatuses);

    // HistoryEntry.action is string; TAction extends string so this assignment is valid.
    const historyEntry: HistoryEntry<TContext, TStates> = {
      action,
      payload,
      exitedStates: result.exitedStates,
      enteredStates: result.enteredStates,
      at: new Date().toISOString(),
      ...(context !== undefined && { context }),
    };

    const updatedSnapshot: InstanceSnapshot<TContext, TStates> = {
      ...currentSnapshot,
      version: currentSnapshot.version + 1,
      stateStatuses: updatedStatuses,
      isTerminal,
      history: [...currentSnapshot.history, historyEntry],
      updatedAt: historyEntry.at,
    };

    return {
      success: true,
      action,
      enteredStates: result.enteredStates,
      exitedStates: result.exitedStates,
      snapshot: updatedSnapshot,
    };
  }

  /**
   * Computes the full set of state status changes resulting from all passing
   * transitions, including ForkState fan-out and JoinState auto-activation.
   *
   * The algorithm runs in a fixed-point loop: after applying direct transitions
   * it keeps re-evaluating JoinStates until no more automatically activate.
   */
  private static computeTransitions<TStates extends string>(
    transitions: TransitionDefinition<TStates>[],
    definition: WorkflowDefinition<unknown, TStates>,
    currentStatuses: Readonly<Record<TStates, StateStatus>>,
  ): EvaluationResult<TStates> {
    const newStatuses: MutableStatusMap<TStates> = new Map(typedEntries(currentStatuses));
    const enteredStates: TStates[] = [];
    const exitedStates: TStates[] = [];

    for (const t of transitions) {
      newStatuses.set(t.from, StateStatus.Completed);
      exitedStates.push(t.from);
      WorkflowEngine.enterState(t.to, definition, newStatuses, enteredStates);
    }

    // Fixed-point: re-check JoinStates until no new activations occur
    let changed = true;
    while (changed) {
      changed = false;
      for (const [id, state] of definition.states) {
        if (state.kind !== StateKind.Join) {
          continue;
        }
        if (newStatuses.get(id) !== StateStatus.Idle) {
          continue;
        }

        if (WorkflowEngine.joinConditionMet(state, newStatuses)) {
          newStatuses.set(id, StateStatus.Active);
          enteredStates.push(id);
          changed = true;
        }
      }
    }

    return { newStatuses, enteredStates, exitedStates };
  }

  /**
   * Applies the entry behaviour for a state based on its kind:
   * - `StepState` → `active`; or `completed` immediately when the state has no
   *   outgoing transitions and is not terminal (dead-end marker — auto-completes
   *   so that a downstream `JoinState` can activate via its `requires` list
   *   without requiring an additional dispatch)
   * - `ForkState` → `completed` (transient), then recursively enters all targets
   * - `JoinState` → deferred; handled by the fixed-point join-check loop
   * - `WaitState` → `waiting`
   */
  private static enterState<TStates extends string>(
    stateId: TStates,
    definition: WorkflowDefinition<unknown, TStates>,
    statuses: MutableStatusMap<TStates>,
    entered: TStates[],
  ): void {
    const state = definition.states.get(stateId);
    if (!state) {
      throw new Error(`State "${stateId}" referenced in a transition but not registered`);
    }

    switch (state.kind) {
      case StateKind.Step: {
        const isDeadEnd = !definition.transitions.some((t) => t.from === stateId)
          && !definition.terminalStateIds.includes(stateId);
        statuses.set(stateId, isDeadEnd ? StateStatus.Completed : StateStatus.Active);
        entered.push(stateId);
        break;
      }

      case StateKind.Fork: {
        // ForkState is transient — complete it immediately and fan out to targets.
        statuses.set(stateId, StateStatus.Completed);
        for (const target of state.targets) {
          // Cast is safe: ForkState.targets are validated at build() to be registered TStates IDs.
          WorkflowEngine.enterState(target as TStates, definition, statuses, entered);
        }
        break;
      }

      case StateKind.Join:
        // JoinState activation is deferred to the fixed-point loop in computeTransitions;
        // no status change is applied here.
        break;

      case StateKind.Wait:
        statuses.set(stateId, StateStatus.Waiting);
        entered.push(stateId);
        break;
    }
  }

  /**
   * Evaluates whether a `JoinState`'s completion threshold has been reached
   * given the current (possibly mid-transition) status map.
   */
  private static joinConditionMet<TStates extends string>(
    join: IJoinState,
    statuses: MutableStatusMap<TStates>,
  ): boolean {
    const completedCount = join.requires.filter(
      // Cast is safe: IJoinState.requires are validated at build() to be registered TStates IDs.
      (id) => statuses.get(id as TStates) === StateStatus.Completed,
    ).length;

    if (join.mode === 'all') {
      return completedCount === join.requires.length;
    }
    if (join.mode === 'any') {
      return completedCount >= 1;
    }
    return completedCount >= join.mode;
  }

  /**
   * Constructs the `GuardContext` passed to every guard during evaluation.
   *
   * Provides the validated payload, the accumulated instance context, the live
   * instance state view, and the guard resolution function for `InjectedGuard`
   * lookups.
   */
  private static buildGuardContext<TStates extends string>(
    payload: unknown,
    instanceState: ReadonlyInstanceState<TStates>,
    guardRegistry: GuardRegistry,
    context: unknown,
  ): GuardContext<unknown, unknown, TStates> {
    return {
      payload,
      context,
      instanceState,
      resolveGuard: (name: string) => guardRegistry.resolve(name),
    };
  }
}
