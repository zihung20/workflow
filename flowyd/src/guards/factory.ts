import type { IGuard, GuardFn } from '../types/index.js';
import { AndGuard } from './and-guard.js';
import { OrGuard } from './or-guard.js';
import { NotGuard } from './not-guard.js';
import { InjectedGuard } from './inject-guard.js';
import { StateCompletedGuard, StateActiveGuard } from './state-guard.js';
import { AlwaysGuard, NeverGuard, FnGuard } from './primitives.js';

/**
 * Factory namespace for constructing and composing guards.
 *
 * All methods return an `IGuard<unknown>` so guards can be freely stored in
 * `TransitionDefinition.guard` without carrying payload-type parameters at
 * the graph definition level. Payload typing is enforced at the
 * `instance.injectGuard<TPayload>()` and `Guard.fn<TPayload>()` call sites.
 *
 * @example
 * ```ts
 * Guard.and([
 *   Guard.inject('isManager'),
 *   Guard.or([
 *     Guard.stateCompleted('legal-review'),
 *     Guard.inject('hasLegalWaiver'),
 *   ]),
 * ])
 * ```
 */
export const Guard = {
  /**
   * Creates a named placeholder guard resolved from the instance's guard
   * registry at evaluation time.
   *
   * @param name - Must match the name passed to `instance.injectGuard()`.
   */
  inject(name: string): InjectedGuard {
    return new InjectedGuard(name);
  },

  /**
   * Creates a guard that passes when the given state has `completed` status.
   *
   * @param stateId - ID of the prerequisite state.
   */
  stateCompleted(stateId: string): StateCompletedGuard {
    return new StateCompletedGuard(stateId);
  },

  /**
   * Creates a guard that passes when the given state has `active` status.
   *
   * @param stateId - ID of the state to check.
   */
  stateActive(stateId: string): StateActiveGuard {
    return new StateActiveGuard(stateId);
  },

  /**
   * Creates a composite guard that passes only when **all** child guards pass.
   * Short-circuits on the first failure.
   *
   * @param guards - At least two guards to evaluate in order.
   */
  and(guards: IGuard<unknown>[]): AndGuard {
    return new AndGuard(guards);
  },

  /**
   * Creates a composite guard that passes when **at least one** child guard passes.
   * Short-circuits on the first success.
   *
   * @param guards - At least two guards to evaluate in order.
   */
  or(guards: IGuard<unknown>[]): OrGuard {
    return new OrGuard(guards);
  },

  /**
   * Creates a guard that inverts the result of its child guard.
   *
   * @param guard - The guard whose result to negate.
   */
  not(guard: IGuard<unknown>): NotGuard {
    return new NotGuard(guard);
  },

  /**
   * Wraps a typed inline function as a guard, for cases where you prefer
   * not to register a named injectable.
   *
   * ```ts
   * Guard.fn<ApprovePayload>((ctx) => ctx.payload.approverId !== '')
   * ```
   *
   * @template T - The expected payload type. Validated by the action schema
   *               at dispatch time before the guard is invoked.
   */
  fn<T = unknown>(fn: GuardFn<T>): FnGuard<T> {
    return new FnGuard(fn);
  },

  /** A guard that always passes. Useful as an explicit no-op in tests. */
  always(): AlwaysGuard {
    return new AlwaysGuard();
  },

  /** A guard that always blocks. Useful for testing blocked transitions. */
  never(): NeverGuard {
    return new NeverGuard();
  },
} as const;
