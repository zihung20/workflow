import type { IGuard, GuardContext } from '../types/index.js';

/**
 * A guard that passes when a specific state in the workflow has reached
 * `completed` status at the time of evaluation.
 *
 * Use this to enforce prerequisites directly in the guard layer rather than
 * relying solely on `JoinState` topology. For example, preventing an APPROVE
 * action unless a required review step has already been completed:
 *
 * ```ts
 * Guard.stateCompleted('security-review')
 * ```
 */
export class StateCompletedGuard implements IGuard<unknown> {
  /**
   * @param stateId - ID of the state that must be in `completed` status
   *                  for this guard to pass.
   */
  constructor(private readonly stateId: string) {}

  evaluate(ctx: GuardContext<unknown>): Promise<boolean> {
    return Promise.resolve(ctx.instanceState.isStateCompleted(this.stateId));
  }
}

/**
 * A guard that passes when a specific state is currently `active`.
 *
 * Less commonly needed than `StateCompletedGuard`, but useful for workflows
 * where one branch needs to confirm that a parallel branch is still in
 * progress before taking an action.
 */
export class StateActiveGuard implements IGuard<unknown> {
  /** @param stateId - ID of the state that must be `active` for this guard to pass. */
  constructor(private readonly stateId: string) {}

  evaluate(ctx: GuardContext<unknown>): Promise<boolean> {
    return Promise.resolve(ctx.instanceState.isStateActive(this.stateId));
  }
}
