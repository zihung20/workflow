import type { IGuard, GuardContext } from '../types/index.js';

/**
 * A composite guard that passes when **at least one** child guard passes.
 * Short-circuits on the first success (does not evaluate remaining guards).
 *
 * @template TPayload - The payload type shared by all child guards.
 */
export class OrGuard<TPayload = unknown> implements IGuard<TPayload> {
  /**
   * @param guards - Two or more guards where at least one must return `true`.
   * @throws {Error} If fewer than two guards are provided.
   */
  constructor(private readonly guards: ReadonlyArray<IGuard<TPayload>>) {
    if (guards.length < 2) throw new Error('OrGuard requires at least two child guards');
  }

  async evaluate(ctx: GuardContext<TPayload>): Promise<boolean> {
    for (const guard of this.guards) {
      if (await guard.evaluate(ctx)) return true;
    }
    return false;
  }
}
