import type { IGuard, GuardContext, GuardFn } from '../types/index.js';

/**
 * A guard that unconditionally passes. Useful as a default in tests or
 * as an explicit "no guard required" marker on transitions.
 */
export class AlwaysGuard implements IGuard<unknown> {
  evaluate(_ctx: GuardContext<unknown>): Promise<boolean> {
    return Promise.resolve(true);
  }
}

/**
 * A guard that unconditionally blocks. Useful in tests to assert that a
 * transition cannot fire regardless of payload.
 */
export class NeverGuard implements IGuard<unknown> {
  evaluate(_ctx: GuardContext<unknown>): Promise<boolean> {
    return Promise.resolve(false);
  }
}

/**
 * Wraps a typed function as an `IGuard`, primarily for storing a guard in a
 * typed variable before attaching it to a transition. For one-off inline
 * guards, prefer the arrow-function shorthand on `addTransition`'s `guard:`
 * property — it is automatically typed from the action's payload schema and
 * the workflow's `TContext`.
 *
 * ```ts
 * // Preferred inline form (auto-typed):
 * .addTransition({ from: 'a', to: 'b', on: 'GO', guard: (ctx) => ctx.payload.score > 50 })
 *
 * // Guard.fn — useful when reusing the same guard across multiple transitions:
 * const highScore = Guard.fn<GoPayload, MyCtx>((ctx) => ctx.payload.score > 50);
 * builder.addTransition({ ..., guard: highScore });
 * builder.addTransition({ ..., guard: highScore });
 * ```
 *
 * @template T        - The payload type the wrapped function expects.
 * @template TContext - The instance context type the function expects.
 */
export class FnGuard<
  T = unknown,
  TContext = unknown,
  TStates extends string = string,
> implements IGuard<unknown> {
  constructor(private readonly fn: GuardFn<T, TContext, TStates>) {}

  evaluate(ctx: GuardContext<unknown>): Promise<boolean> {
    // Cast is safe: the engine validates payload against the action schema before
    // calling evaluate, context is the live instance context, and all state IDs
    // in instanceState are registered TStates by construction.
    return Promise.resolve(this.fn(ctx as GuardContext<T, TContext, TStates>));
  }
}
