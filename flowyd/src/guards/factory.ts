import type { IGuard, GuardFn } from '../types/index.js';
import { AndGuard } from './and-guard.js';
import { OrGuard } from './or-guard.js';
import { NotGuard } from './not-guard.js';
import { InjectedGuard } from './inject-guard.js';
import { StateCompletedGuard, StateActiveGuard } from './state-guard.js';
import { AlwaysGuard, NeverGuard } from './constant-guards.js';
import { FnGuard } from './fn-guard.js';

/**
 * Factory namespace for constructing and composing guards.
 *
 * All guards implement `IGuard<unknown>` so they can be freely stored in
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
   * @throws {Error} If fewer than two guards are provided.
   */
  and(guards: IGuard<unknown>[]): AndGuard {
    return new AndGuard(guards);
  },

  /**
   * Creates a composite guard that passes when **at least one** child guard passes.
   * Short-circuits on the first success.
   *
   * @param guards - At least two guards to evaluate in order.
   * @throws {Error} If fewer than two guards are provided.
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
   * Wraps a typed function as a guard. Useful when the same guard logic is
   * shared across multiple transitions — store it in a variable and pass it
   * to each `addTransition` call. For one-off inline guards prefer the arrow
   * function shorthand directly on `addTransition`'s `guard:` property.
   *
   * ```ts
   * const highScore = Guard.fn<ApprovePayload, MyContext>((ctx) => ctx.context.score >= 80);
   * builder.addTransition({ from: 'a', to: 'b', on: 'APPROVE', guard: highScore });
   * builder.addTransition({ from: 'a', to: 'c', on: 'APPROVE', guard: highScore });
   * ```
   *
   * @template T        - The expected payload type. Validated by the action
   *                      schema at dispatch time before the guard is invoked.
   * @template TContext - The instance context type. Inferred automatically
   *                      when used as an inline guard on `addTransition`.
   */
  fn<T = unknown, TContext = unknown>(fn: GuardFn<T, TContext>): FnGuard<T, TContext> {
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
