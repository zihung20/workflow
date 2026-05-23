import type { ReadonlyInstanceState } from './instance.js';

/**
 * Data available to every guard during transition evaluation.
 *
 * @template TPayload - The validated payload type of the action that
 *                      triggered the guard check.
 */
export interface GuardContext<TPayload> {
  /** The Zod-validated action payload. Typed to the specific action's schema. */
  readonly payload: TPayload;

  /**
   * Live read-only snapshot of the instance's current state map.
   * Use this to write guards that depend on other steps being completed
   * (e.g. `ctx.instanceState.isStateCompleted('legal-review')`).
   */
  readonly instanceState: ReadonlyInstanceState;

  /**
   * Resolves a named guard function registered via `instance.injectGuard()`.
   *
   * @internal Called by `InjectedGuard` — guard authors should not call this directly.
   */
  resolveGuard(name: string): GuardFn<unknown> | undefined;
}

/**
 * The core guard contract. Guards are stateless, composable predicates
 * evaluated synchronously or asynchronously by the engine before a
 * transition is applied.
 *
 * All built-in guards (`AndGuard`, `OrGuard`, `NotGuard`, etc.) and
 * user-injected guards implement this interface.
 *
 * @template TPayload - The payload type this guard operates on.
 *                      Defaults to `unknown` so guards can be composed
 *                      and stored without carrying the payload type.
 */
export interface IGuard<TPayload = unknown> {
  /**
   * @param ctx - Full guard context including the action payload and live instance state.
   * @returns `true` to allow the transition; `false` to block it.
   */
  evaluate(ctx: GuardContext<TPayload>): Promise<boolean>;
}

/**
 * Signature for a user-supplied guard function.
 *
 * @template TPayload - The expected shape of the action payload. When using
 *                      `Guard.inject('name')`, annotate this at the
 *                      `instance.injectGuard<TPayload>('name', fn)` call site.
 */
export type GuardFn<TPayload> = (ctx: GuardContext<TPayload>) => boolean | Promise<boolean>;
