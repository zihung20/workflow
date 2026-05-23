import type { IGuard } from './guard.js';

/**
 * Declares a conditional arc between two states in the workflow graph.
 *
 * A transition fires when all three of the following are true:
 * 1. The `from` state is currently `active`.
 * 2. The dispatched action matches `on`.
 * 3. The `guard` (if present) evaluates to `true`.
 *
 * When fired, the engine marks `from` as `completed` and enters `to`
 * according to the target state's kind.
 */
export interface TransitionDefinition {
  /** ID of the source state. Must be `active` for this transition to fire. */
  readonly from: string;
  /** ID of the destination state to enter on a successful transition. */
  readonly to: string;
  /** Action name that triggers evaluation of this transition. */
  readonly on: string;
  /**
   * Optional guard evaluated before the transition is applied.
   * Stored as `IGuard<unknown>` because payload typing is resolved at the
   * `dispatch` call site — the engine passes the runtime-validated payload
   * through the `GuardContext`.
   */
  readonly guard?: IGuard<unknown>;
}
