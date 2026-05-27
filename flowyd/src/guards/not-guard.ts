import type { IGuard, GuardContext } from '../types/index.js';

/**
 * A decorator guard that inverts the result of its child guard.
 *
 * @template TPayload - The payload type forwarded to the wrapped guard.
 */
export class NotGuard<TPayload = unknown> implements IGuard<TPayload> {
  constructor(private readonly guard: IGuard<TPayload>) {}

  async evaluate(ctx: GuardContext<TPayload>): Promise<boolean> {
    return !(await this.guard.evaluate(ctx));
  }
}
