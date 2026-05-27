import { describe, it, expect } from 'vitest';
import { StateCompletedGuard, StateActiveGuard } from './state-guard.js';
import { makeCtx } from '../../tests/helpers.js';

describe('StateCompletedGuard', () => {
  it('passes when the target state is completed', async () => {
    const g = new StateCompletedGuard('legal-review');
    const ctx = makeCtx({}, { isStateCompleted: (id) => id === 'legal-review' });
    expect(await g.evaluate(ctx)).toBe(true);
  });

  it('blocks when the target state is not completed', async () => {
    const g = new StateCompletedGuard('legal-review');
    expect(await g.evaluate(makeCtx())).toBe(false);
  });
});

describe('StateActiveGuard', () => {
  it('passes when the target state is active', async () => {
    const g = new StateActiveGuard('review');
    const ctx = makeCtx({}, { isStateActive: (id) => id === 'review' });
    expect(await g.evaluate(ctx)).toBe(true);
  });

  it('blocks when the target state is not active', async () => {
    const g = new StateActiveGuard('review');
    expect(await g.evaluate(makeCtx())).toBe(false);
  });
});
