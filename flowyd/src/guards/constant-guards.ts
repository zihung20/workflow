import type { IGuard, GuardContext } from '../types/index.js';

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
