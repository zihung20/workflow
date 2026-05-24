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

/**
 * Intermediate, mutable state map computed during a single engine evaluation.
 * Never exposed outside this module.
 */
type MutableStatusMap = Map<string, StateStatus>;

/**
 * Result of a single engine evaluation cycle, before it is committed to the
 * instance.
 */
interface EvaluationResult {
  readonly newStatuses: MutableStatusMap;
  readonly enteredStates: string[];
  readonly exitedStates: string[];
}

/**
 * Pure, stateless engine that evaluates a dispatched action against the
 * current instance state and computes the resulting state changes.
 *
 * The engine never mutates the instance directly — it returns a computed
 * `EvaluationResult` which `WorkflowInstance` applies atomically. This
 * separation means the engine is trivially unit-testable and can be
 * exercised with any state snapshot.
 */
export class WorkflowEngine {
  /**
   * Evaluates a dispatched action against the current instance state.
   *
   * @param definition     - The immutable compiled workflow graph.
   * @param instanceState  - Read-only view of the current instance state.
   * @param guardRegistry  - The instance's registered guard functions.
   * @param currentSnapshot - Full snapshot used to produce the updated one on success.
   * @param action          - The action name being dispatched.
   * @param payload         - The Zod-validated action payload.
   * @returns A `DispatchResult` discriminated union. On success, includes the
   *          updated snapshot and lists of entered/exited states.
   */
  static async dispatch(
    definition: WorkflowDefinition,
    instanceState: ReadonlyInstanceState,
    guardRegistry: GuardRegistry,
    currentSnapshot: InstanceSnapshot,
    action: string,
    payload: unknown,
  ): Promise<DispatchResult> {
    if (currentSnapshot.isTerminal) {
      return {
        success: false,
        action,
        reason: 'terminal-state',
        activeStates: instanceState.getActiveStates().slice(),
      };
    }

    // Find all transitions that could fire: source is active AND action matches
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

    // Evaluate guards for each candidate
    const guardCtx = WorkflowEngine.buildGuardContext(payload, instanceState, guardRegistry);
    const passing: TransitionDefinition[] = [];

    for (const candidate of candidates) {
      const allowed = candidate.guard ? await candidate.guard.evaluate(guardCtx) : true;
      if (allowed) passing.push(candidate);
    }

    if (passing.length === 0) {
      return {
        success: false,
        action,
        reason: 'guard-failed',
        activeStates: instanceState.getActiveStates().slice(),
      };
    }

    // Compute resulting state changes without mutating the instance
    const result = WorkflowEngine.computeTransitions(passing, definition, currentSnapshot.stateStatuses);

    // Determine if the workflow has reached a terminal state
    const isTerminal = definition.terminalStateIds.some(
      (id) => result.newStatuses.get(id) === StateStatus.Active,
    );

    const historyEntry: HistoryEntry = {
      action,
      payload,
      exitedStates: result.exitedStates,
      enteredStates: result.enteredStates,
      at: new Date().toISOString(),
    };

    const updatedStatuses: Record<string, StateStatus> = {};
    for (const [id, status] of result.newStatuses) {
      updatedStatuses[id] = status;
    }

    const updatedSnapshot: InstanceSnapshot = {
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
  private static computeTransitions(
    transitions: TransitionDefinition[],
    definition: WorkflowDefinition,
    currentStatuses: Readonly<Record<string, StateStatus>>,
  ): EvaluationResult {
    const newStatuses: MutableStatusMap = new Map(Object.entries(currentStatuses));
    const enteredStates: string[] = [];
    const exitedStates: string[] = [];

    // Apply each passing transition
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
        if (state.kind !== StateKind.Join) continue;
        if (newStatuses.get(id) !== StateStatus.Idle) continue;

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
   * - `StepState` → `active`
   * - `ForkState` → `completed` (transient), then recursively enters all targets
   * - `JoinState` → deferred; handled by the fixed-point join-check loop
   * - `SubWorkflowState` → `waiting`
   */
  private static enterState(
    stateId: string,
    definition: WorkflowDefinition,
    statuses: MutableStatusMap,
    entered: string[],
  ): void {
    const state = definition.states.get(stateId);
    if (!state) throw new Error(`State "${stateId}" referenced in a transition but not registered`);

    switch (state.kind) {
      case StateKind.Step:
        statuses.set(stateId, StateStatus.Active);
        entered.push(stateId);
        break;

      case StateKind.Fork: {
        // ForkState is transient — complete it immediately and fan out to targets
        statuses.set(stateId, StateStatus.Completed);
        for (const target of state.targets) {
          WorkflowEngine.enterState(target, definition, statuses, entered);
        }
        break;
      }

      case StateKind.Join:
        // JoinState activation is deferred to the fixed-point loop above;
        // no status change is applied here.
        break;

      case StateKind.SubWorkflow:
        statuses.set(stateId, StateStatus.Waiting);
        entered.push(stateId);
        break;
    }
  }

  /**
   * Evaluates whether a `JoinState`'s completion threshold has been reached
   * given the current (possibly mid-transition) status map.
   */
  private static joinConditionMet(join: IJoinState, statuses: MutableStatusMap): boolean {
    const completedCount = join.requires.filter(
      (id) => statuses.get(id) === StateStatus.Completed,
    ).length;

    if (join.mode === 'all') return completedCount === join.requires.length;
    if (join.mode === 'any') return completedCount >= 1;
    return completedCount >= join.mode;
  }

  /**
   * Constructs the `GuardContext` passed to every guard during evaluation.
   *
   * Provides the typed payload, the live instance state view, and the
   * guard resolution function for `InjectedGuard` lookups.
   */
  private static buildGuardContext(
    payload: unknown,
    instanceState: ReadonlyInstanceState,
    guardRegistry: GuardRegistry,
  ): GuardContext<unknown> {
    return {
      payload,
      instanceState,
      resolveGuard: (name: string) => guardRegistry.resolve(name),
    };
  }
}
