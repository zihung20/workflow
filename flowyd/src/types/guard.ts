import type { ReadonlyInstanceState } from './instance.js';

/**
 * Data available to every guard during transition evaluation.
 *
 * @template TPayload - The validated payload type of the action that
 *                      triggered the guard check.
 * @template TContext - The type of the instance's accumulated context,
 *                      set via `instance.setContext()`. Defaults to `unknown`
 *                      when no context schema has been declared.
 */
export interface GuardContext<TPayload, TContext = unknown, TStates extends string = string> {
  /** The Zod-validated action payload. Typed to the specific action's schema. */
  readonly payload: TPayload;

  /**
   * Accumulated instance context set by the caller via `instance.setContext()`.
   * Persists across all dispatches for the lifetime of the instance.
   * Use this for data that must survive between steps (e.g. computed scores,
   * role information, counter values).
   */
  readonly context: TContext;

  /**
   * Live read-only snapshot of the instance's current state map.
   * Use this to write guards that depend on other steps being completed
   * (e.g. `ctx.instanceState.isStateCompleted('legal-review')`).
   */
  readonly instanceState: ReadonlyInstanceState<TStates>;

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
   * @param ctx - Full guard context including the action payload, instance context, and live instance state.
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
 * @template TContext - The instance context type. Inferred automatically when
 *                      used as an inline guard on `addTransition`. Annotate
 *                      explicitly when used with `Guard.fn<TPayload, TContext>()`.
 */
export type GuardFn<TPayload, TContext = unknown, TStates extends string = string> = (ctx: GuardContext<TPayload, TContext, TStates>) => boolean | Promise<boolean>;
