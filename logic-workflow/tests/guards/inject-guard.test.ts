import { describe, it, expect } from 'vitest';
import { InjectedGuard } from '../../src/guards/inject-guard.js';
import type { GuardFn } from '../../src/types/index.js';
import { makeCtx } from '../helpers.js';

describe('InjectedGuard', () => {
  it('resolves and invokes the registered function', async () => {
    const guard = new InjectedGuard('canApprove');
    const ctx = {
      ...makeCtx({ role: 'manager' }),
      resolveGuard: (name: string): GuardFn<unknown> | undefined =>
        name === 'canApprove'
          ? async (c) => (c.payload as { role: string }).role === 'manager'
          : undefined,
    };
    expect(await guard.evaluate(ctx)).toBe(true);
  });

  it('throws when the guard has not been injected', async () => {
    const guard = new InjectedGuard('missingGuard');
    await expect(guard.evaluate(makeCtx())).rejects.toThrow('missingGuard');
  });

  it('stores the guard name for diagnostics', () => {
    expect(new InjectedGuard('myGuard').name).toBe('myGuard');
  });
});
