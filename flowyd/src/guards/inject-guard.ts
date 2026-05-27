import type { IGuard, GuardContext } from '../types/index.js';

/**
 * A named guard placeholder resolved at evaluation time from the instance's
 * guard registry.
 *
 * Use `Guard.inject('name')` at workflow definition time to declare a guard
 * whose implementation will be provided later via
 * `instance.injectGuard('name', fn)`. This allows the same workflow
 * definition to use different guard implementations in production, staging,
 * and tests without recompiling the workflow.
 *
 * The payload type of the injected function is not statically enforced here
 * because the guard is defined before the action payload type is known.
 * Annotate the generic at the `injectGuard` call site to preserve type safety:
 *
 * ```ts
 * instance.injectGuard<ApprovePayload>('canApprove', async (ctx) => {
 *   return ctx.payload.approverId === currentUser.id;
 * });
 * ```
 */
export class InjectedGuard implements IGuard<unknown> {
  /**
   * @param name - The registry key used to look up the injected function.
   *               Must match the name passed to `instance.injectGuard()`.
   */
  constructor(readonly name: string) {}

  async evaluate(ctx: GuardContext<unknown>): Promise<boolean> {
    const fn = ctx.resolveGuard(this.name);
    if (!fn) {
      throw new Error(
        `Guard "${this.name}" has not been injected. ` +
          `Call instance.injectGuard("${this.name}", fn) before dispatching.`,
      );
    }
    return fn(ctx);
  }
}
