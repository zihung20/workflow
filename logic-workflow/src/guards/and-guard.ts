import type { IGuard, GuardContext } from '../types/index.js';

/**
 * A composite guard that passes only when **every** child guard passes.
 * Short-circuits on the first failure (does not evaluate remaining guards).
 *
 * @template TPayload - The payload type shared by all child guards.
 */
export class AndGuard<TPayload = unknown> implements IGuard<TPayload> {
  /**
   * @param guards - Two or more guards that must all return `true`.
   * @throws {Error} If fewer than two guards are provided.
   */
  constructor(private readonly guards: ReadonlyArray<IGuard<TPayload>>) {
    if (guards.length < 2) throw new Error('AndGuard requires at least two child guards');
  }

  async evaluate(ctx: GuardContext<TPayload>): Promise<boolean> {
    for (const guard of this.guards) {
      if (!(await guard.evaluate(ctx))) return false;
    }
    return true;
  }
}
