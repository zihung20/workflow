import { describe, it, expect } from 'vitest';
import { FnGuard } from './fn-guard.js';
import { makeCtx } from '../../tests/helpers.js';

describe('FnGuard', () => {
  it('passes when the wrapped function returns true', async () => {
    const g = new FnGuard(() => true);
    expect(await g.evaluate(makeCtx())).toBe(true);
  });

  it('blocks when the wrapped function returns false', async () => {
    const g = new FnGuard(() => false);
    expect(await g.evaluate(makeCtx())).toBe(false);
  });

  it('receives the guard context', async () => {
    const g = new FnGuard<{ score: number }>((ctx) => ctx.payload.score >= 80);
    expect(await g.evaluate(makeCtx({ score: 90 }))).toBe(true);
    expect(await g.evaluate(makeCtx({ score: 70 }))).toBe(false);
  });

  it('supports promise-returning functions', async () => {
    const g = new FnGuard(() => Promise.resolve(true));
    expect(await g.evaluate(makeCtx())).toBe(true);
  });
});
