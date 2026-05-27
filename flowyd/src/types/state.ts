/**
 * Discriminant tag identifying each built-in state kind.
 * The engine uses this at runtime to select the correct entry behaviour
 * (e.g. ForkState immediately activates its targets; JoinState defers
 * activation until prerequisites are satisfied).
 */
export enum StateKind {
  Step = 'step',
  Fork = 'fork',
  Join = 'join',
  Wait = 'wait',
}

/**
 * Lifecycle phase of a state within a running `WorkflowInstance`.
 *
 * - `idle`      — not yet reached in this run.
 * - `active`    — the current resting point; waiting for a dispatched action.
 * - `waiting`   — blocked on an external process (used by `WaitState`).
 * - `completed` — permanently exited; cannot be re-entered.
 */
export enum StateStatus {
  Idle = 'idle',
  Active = 'active',
  Waiting = 'waiting',
  Completed = 'completed',
}

/**
 * Core contract shared by every state in a workflow graph.
 */
export interface IState {
  readonly id: string;
  readonly kind: StateKind;
  readonly label: string;
}

/**
 * A `ForkState` atomically activates one or more downstream states when
 * entered, then immediately completes itself (it is a transient state).
 *
 * Use this to spawn parallel branches of an SOP without requiring the caller
 * to dispatch separate actions for each branch.
 */
export interface IForkState extends IState {
  readonly kind: StateKind.Fork;
  /** IDs of the states to activate simultaneously on entry. At least one required. */
  readonly targets: readonly string[];
}

/**
 * Threshold rule for a `JoinState`.
 *
 * - `'all'`    — every state in `requires` must be completed.
 * - `'any'`    — at least one state in `requires` must be completed.
 * - `number`   — at least N states in `requires` must be completed (quorum).
 */
export type JoinMode = 'all' | 'any' | number;

/**
 * A `JoinState` acts as a synchronisation barrier. It monitors a set of
 * prerequisite states and becomes `active` automatically once the `mode`
 * threshold is satisfied — no explicit dispatch is required to cross the
 * barrier itself.
 *
 * Once active, it behaves like a `StepState`: it waits for a dispatched
 * action to transition out.
 */
export interface IJoinState extends IState {
  readonly kind: StateKind.Join;
  /** IDs of the states that must reach `completed` before this join activates. */
  readonly requires: readonly string[];
  readonly mode: JoinMode;
}

/**
 * A `WaitState` blocks the parent workflow until an external signal arrives.
 *
 * The engine sets the state to `waiting` on entry. The service layer is
 * responsible for calling `instance.resolveWait(stateId)` once the external
 * process has completed, which transitions the state to `active` so the
 * parent workflow can resume via a normal `dispatch`.
 */
export interface IWaitState extends IState {
  readonly kind: StateKind.Wait;
  /** Name of the external process this state is waiting for. Documentary only. */
  readonly externalName: string;
}

/**
 * A `StepState` — the fundamental SOP milestone. Becomes `active` when
 * entered and waits for an explicit dispatched action to transition out.
 */
export interface IStepState extends IState {
  readonly kind: StateKind.Step;
}

/**
 * Discriminated union of all built-in state kinds.
 *
 * Typed as the map value in `WorkflowDefinition.states` and `StateRegistry`
 * so that the engine and visualization layer can narrow to a specific state
 * interface via a `kind` check without unsafe casts.
 */
export type AnyState = IStepState | IForkState | IJoinState | IWaitState;
