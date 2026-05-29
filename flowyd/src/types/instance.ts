import type { StateStatus } from './state.js';

/**
 * Read-only view of a `WorkflowInstance`'s current runtime state, passed to
 * guards during transition evaluation.
 *
 * Guards may inspect the live status of any state in the graph but must not
 * mutate instance state — the engine is the sole writer.
 */
export interface ReadonlyInstanceState<TStates extends string = string> {
  readonly instanceId: string;
  readonly workflowName: string;

  /** Returns the current `StateStatus` of the given state ID. */
  getStateStatus(stateId: TStates): StateStatus;

  /** Returns IDs of all states currently in `active` status. */
  getActiveStates(): readonly TStates[];

  /** Returns IDs of all states currently in `waiting` status. */
  getWaitingStates(): readonly TStates[];

  /** Returns IDs of all states that have reached `completed` status. */
  getCompletedStates(): readonly TStates[];

  isStateCompleted(stateId: TStates): boolean;
  isStateActive(stateId: TStates): boolean;
  isStateWaiting(stateId: TStates): boolean;
}

/**
 * A single entry in the immutable audit trail of a `WorkflowInstance`.
 *
 * @template TContext - The instance context type, matching the parent
 *                      `InstanceSnapshot`. Defaults to `unknown` for
 *                      type-erased storage (engine, persistence layer).
 */
export interface HistoryEntry<TContext = unknown, TStates extends string = string> {
  /** The action name that triggered this transition. */
  readonly action: string;
  /** The Zod-validated payload that was dispatched with the action. */
  readonly payload: unknown;
  /** State IDs that were completed by this transition. */
  readonly exitedStates: readonly TStates[];
  /** State IDs that became active, waiting, or were auto-activated as a result. */
  readonly enteredStates: readonly TStates[];
  /**
   * Instance context in effect when this transition was dispatched.
   * Used by `WorkflowInstance.rewind()` to restore context at any past version.
   */
  readonly context?: TContext;
  /** ISO-8601 timestamp of when this transition was applied. */
  readonly at: string;
}

/**
 * A plain, JSON-serialisable representation of all runtime state for a
 * `WorkflowInstance` at a given point in time.
 *
 * Designed to be stored in any persistence layer (Postgres, Redis, S3, etc.)
 * and passed back to `workflow.restoreInstance(snapshot)` to reconstruct a
 * live instance. Guard injections are NOT part of the snapshot — the service
 * layer must re-inject them after restoration.
 *
 * @template TContext - The caller-owned context type declared via
 *                      `WorkflowBuilder.setContext()`. Defaults to `unknown`
 *                      for type-erased storage sites (engine, visualisation).
 */
export interface InstanceSnapshot<TContext = unknown, TStates extends string = string> {
  readonly instanceId: string;
  readonly workflowName: string;
  /**
   * Monotonically increasing counter incremented on every successful dispatch.
   * Use for optimistic locking in your service layer (e.g. a Prisma `where: { version }` check).
   */
  readonly version: number;
  /** Full status map for every state in the workflow. */
  readonly stateStatuses: Readonly<Record<TStates, StateStatus>>;
  readonly isTerminal: boolean;
  readonly history: readonly HistoryEntry<TContext, TStates>[];
  /**
   * Caller-owned context set via `instance.setContext()`. Persists in the
   * snapshot so it survives `getSnapshot()` / `restoreInstance()` round-trips.
   * `undefined` when no context has been set.
   */
  readonly context?: TContext;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Returned by `WorkflowInstance.dispatch()` on a successful state transition.
 *
 * @template TContext - Context type of the owning instance. Defaults to `unknown`
 *                      for the type-erased engine layer.
 * @template TStates  - Union of registered state IDs. Defaults to `string` for
 *                      the type-erased engine layer. Narrows `enteredStates` and
 *                      `exitedStates` to the workflow's known state-ID literals.
 * @template TAction  - The specific action name that was dispatched. Defaults to
 *                      `string` for the type-erased engine layer.
 */
export interface TransitionSuccess<
  TContext = unknown,
  TStates extends string = string,
  TAction extends string = string,
> {
  readonly success: true;
  /** The action name that was dispatched. */
  readonly action: TAction;
  /** States that became active or waiting as a result of this transition. */
  readonly enteredStates: readonly TStates[];
  /** States that were completed by this transition. */
  readonly exitedStates: readonly TStates[];
  /** The updated snapshot after the transition has been applied. */
  readonly snapshot: InstanceSnapshot<TContext, TStates>;
}

/**
 * Returned by `WorkflowInstance.dispatch()` when the action cannot be applied.
 *
 * @template TStates  - Union of registered state IDs. Defaults to `string` for
 *                      the type-erased engine layer. Narrows `activeStates` to
 *                      the workflow's known state-ID literals.
 * @template TAction  - The specific action name that was dispatched. Defaults to
 *                      `string` for the type-erased engine layer.
 */
export interface TransitionBlocked<
  TStates extends string = string,
  TAction extends string = string,
> {
  readonly success: false;
  /** The action name that was dispatched. */
  readonly action: TAction;
  readonly reason:
    | 'terminal-state' // workflow has already reached a terminal state
    | 'invalid-action' // no transition exists for this action from any active state
    | 'guard-failed' // a matching transition exists but its guard blocked it
    | 'no-active-source'; // the action's source state is not currently active
  readonly activeStates: readonly TStates[];
}

/**
 * Discriminated union returned by every `dispatch` call.
 *
 * @template TContext - Context type of the owning instance. Defaults to `unknown`.
 * @template TStates  - Union of registered state IDs. Defaults to `string` for the
 *                      type-erased engine layer.
 * @template TAction  - The specific action name that was dispatched. Defaults to
 *                      `string` for the type-erased engine layer.
 */
export type DispatchResult<
  TContext = unknown,
  TStates extends string = string,
  TAction extends string = string,
> = TransitionSuccess<TContext, TStates, TAction> | TransitionBlocked<TStates, TAction>;
