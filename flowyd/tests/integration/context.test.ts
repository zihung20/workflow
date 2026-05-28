import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { createWorkflow } from '../../src/core/builder.js';
import { Guard } from '../../src/guards/factory.js';

const RoleContextSchema = z.object({
  isDutyManager: z.boolean(),
  score: z.number(),
});
type RoleContext = z.infer<typeof RoleContextSchema>;

const Empty = z.object({});

function makeApprovalWf() {
  return createWorkflow({ name: 'approval' })
    .setContext(RoleContextSchema)
    .defineAction('SUBMIT', Empty)
    .defineAction('APPROVE', Empty)
    .defineAction('REJECT', Empty)
    .addStep('draft')
    .addStep('review')
    .addStep('approved')
    .addStep('rejected')
    .setInitial('draft')
    .setTerminal(['approved', 'rejected'])
    .addTransition({ from: 'draft', to: 'review', on: 'SUBMIT' })
    .addTransition({
      from: 'review',
      to: 'approved',
      on: 'APPROVE',
      guard: (ctx) => ctx.context.isDutyManager && ctx.context.score >= 80,
    })
    .addTransition({ from: 'review', to: 'rejected', on: 'REJECT' })
    .build();
}

// ─── createInstance ───────────────────────────────────────────────────────────

describe('context — createInstance', () => {
  it('stores context in the snapshot', () => {
    const wf = makeApprovalWf();
    const inst = wf.createInstance('ctx-001', { isDutyManager: true, score: 90 });
    expect(inst.getSnapshot().context).toEqual({ isDutyManager: true, score: 90 });
  });

  it('getContext() returns the value passed at creation', () => {
    const wf = makeApprovalWf();
    const inst = wf.createInstance('ctx-002', { isDutyManager: false, score: 55 });
    expect(inst.getContext()).toEqual({ isDutyManager: false, score: 55 });
  });

  it('context is undefined when no schema was declared and no context is passed', () => {
    const wf = createWorkflow({ name: 'no-ctx' })
      .defineAction('GO', Empty)
      .addStep('a').addStep('b')
      .setInitial('a').setTerminal(['b'])
      .addTransition({ from: 'a', to: 'b', on: 'GO' })
      .build();
    const inst = wf.createInstance('ctx-003');
    expect(inst.getContext()).toBeUndefined();
  });
});

// ─── setContext / getContext ───────────────────────────────────────────────────

describe('context — setContext / getContext', () => {
  it('updates context and returns this for chaining', () => {
    const wf = makeApprovalWf();
    const inst = wf.createInstance('ctx-010', { isDutyManager: false, score: 0 });
    const returned = inst.setContext({ isDutyManager: true, score: 88 });
    expect(returned).toBe(inst);
    expect(inst.getContext()).toEqual({ isDutyManager: true, score: 88 });
  });

  it('replaces the previous context entirely', () => {
    const wf = makeApprovalWf();
    const inst = wf.createInstance('ctx-011', { isDutyManager: false, score: 40 });
    inst.setContext({ isDutyManager: true, score: 95 });
    expect(inst.getContext()).toEqual({ isDutyManager: true, score: 95 });
  });

  it('persists context in the snapshot after setContext', () => {
    const wf = makeApprovalWf();
    const inst = wf.createInstance('ctx-012', { isDutyManager: false, score: 0 });
    inst.setContext({ isDutyManager: true, score: 81 });
    expect(inst.getSnapshot().context).toEqual({ isDutyManager: true, score: 81 });
  });
});

// ─── guards reading context ───────────────────────────────────────────────────

describe('context — guards', () => {
  it('inline guard allows transition when context passes', async () => {
    const wf = makeApprovalWf();
    const inst = wf.createInstance('ctx-020', { isDutyManager: true, score: 80 });
    await inst.dispatch('SUBMIT', {});
    const result = await inst.dispatch('APPROVE', {});
    expect(result.success).toBe(true);
    expect(inst.getCurrentStates()).toEqual(['approved']);
  });

  it('inline guard blocks when isDutyManager is false', async () => {
    const wf = makeApprovalWf();
    const inst = wf.createInstance('ctx-021', { isDutyManager: false, score: 99 });
    await inst.dispatch('SUBMIT', {});
    const result = await inst.dispatch('APPROVE', {});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe('guard-failed');
    }
  });

  it('inline guard blocks when score is below threshold', async () => {
    const wf = makeApprovalWf();
    const inst = wf.createInstance('ctx-022', { isDutyManager: true, score: 79 });
    await inst.dispatch('SUBMIT', {});
    const result = await inst.dispatch('APPROVE', {});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe('guard-failed');
    }
  });

  it('injected guard receives context via ctx.context', async () => {
    const wf = createWorkflow({ name: 'inject-ctx' })
      .setContext(z.object({ allowedIds: z.array(z.string()) }))
      .defineAction('GO', z.object({ userId: z.string() }))
      .addStep('a')
      .addStep('b')
      .setInitial('a')
      .setTerminal(['b'])
      .addTransition({ from: 'a', to: 'b', on: 'GO', guard: Guard.inject('isAllowed') })
      .build();

    const inst = wf.createInstance('ctx-023', { allowedIds: ['u1', 'u2'] });
    inst.injectGuard<{ userId: string }, { allowedIds: string[] }>(
      'isAllowed',
      (ctx) => ctx.context.allowedIds.includes(ctx.payload.userId),
    );

    expect((await inst.dispatch('GO', { userId: 'u1' })).success).toBe(true);
  });

  it('Guard.fn with explicit TContext annotation', async () => {
    const scoreGuard = Guard.fn<object, RoleContext>((ctx) => ctx.context.score >= 90);

    const wf = createWorkflow({ name: 'fn-guard-ctx' })
      .setContext(RoleContextSchema)
      .defineAction('GO', Empty)
      .addStep('a')
      .addStep('b')
      .setInitial('a')
      .setTerminal(['b'])
      .addTransition({ from: 'a', to: 'b', on: 'GO', guard: scoreGuard })
      .build();

    const passing = wf.createInstance('ctx-024a', { isDutyManager: true, score: 90 });
    expect((await passing.dispatch('GO', {})).success).toBe(true);

    const blocked = wf.createInstance('ctx-024b', { isDutyManager: true, score: 89 });
    expect((await blocked.dispatch('GO', {})).success).toBe(false);
  });
});

// ─── context across dispatches and snapshot round-trips ───────────────────────

describe('context — persistence', () => {
  it('context survives across multiple dispatches', async () => {
    const wf = makeApprovalWf();
    const ctx: RoleContext = { isDutyManager: true, score: 85 };
    const inst = wf.createInstance('ctx-030', ctx);
    await inst.dispatch('SUBMIT', {});
    expect(inst.getContext()).toEqual(ctx);
    await inst.dispatch('APPROVE', {});
    expect(inst.getContext()).toEqual(ctx);
  });

  it('setContext between dispatches is seen by the next guard', async () => {
    const wf = makeApprovalWf();
    const inst = wf.createInstance('ctx-031', { isDutyManager: false, score: 50 });
    await inst.dispatch('SUBMIT', {});

    // Guard would block with current context — update it
    inst.setContext({ isDutyManager: true, score: 90 });
    const result = await inst.dispatch('APPROVE', {});
    expect(result.success).toBe(true);
  });

  it('context is preserved through getSnapshot / restoreInstance', async () => {
    const wf = makeApprovalWf();
    const inst = wf.createInstance('ctx-032', { isDutyManager: true, score: 82 });
    await inst.dispatch('SUBMIT', {});
    const snap = inst.getSnapshot();

    const restored = wf.restoreInstance(snap);
    expect(restored.getContext()).toEqual({ isDutyManager: true, score: 82 });
    const result = await restored.dispatch('APPROVE', {});
    expect(result.success).toBe(true);
  });

  it('context in the snapshot is a deep copy — mutations do not affect the live instance', () => {
    const wf = makeApprovalWf();
    const inst = wf.createInstance('ctx-033', { isDutyManager: true, score: 70 });
    const snap = inst.getSnapshot();
    // Force-mutate the snapshot's context field
    const mutableCtx = snap.context as { score: number };
    mutableCtx.score = 999;
    expect(inst.getContext()?.score).toBe(70);
  });
});

// ─── runtime validation ───────────────────────────────────────────────────────

describe('context — runtime Zod validation', () => {
  it('createInstance throws ZodError when context violates the schema', () => {
    const wf = createWorkflow({ name: 'range-check' })
      .setContext(z.object({ level: z.number().min(1).max(10) }))
      .defineAction('GO', Empty)
      .addStep('a').addStep('b')
      .setInitial('a').setTerminal(['b'])
      .addTransition({ from: 'a', to: 'b', on: 'GO' })
      .build();

    expect(() =>
      // Force past TypeScript to test runtime behaviour
      (wf.createInstance as (id: string, ctx: unknown) => unknown)('rt-001', { level: 11 }),
    ).toThrow();
  });

  it('setContext throws ZodError when context violates the schema', () => {
    const wf = createWorkflow({ name: 'range-check-2' })
      .setContext(z.object({ level: z.number().min(1).max(10) }))
      .defineAction('GO', Empty)
      .addStep('a').addStep('b')
      .setInitial('a').setTerminal(['b'])
      .addTransition({ from: 'a', to: 'b', on: 'GO' })
      .build();

    const inst = wf.createInstance('rt-002', { level: 5 });
    expect(() =>
      (inst.setContext as (ctx: unknown) => unknown)({ level: 11 }),
    ).toThrow();
  });

  it('valid context passes through without error', () => {
    const wf = createWorkflow({ name: 'range-check-3' })
      .setContext(z.object({ level: z.number().min(1).max(10) }))
      .defineAction('GO', Empty)
      .addStep('a').addStep('b')
      .setInitial('a').setTerminal(['b'])
      .addTransition({ from: 'a', to: 'b', on: 'GO' })
      .build();

    expect(() => wf.createInstance('rt-003', { level: 10 })).not.toThrow();
  });

  it('failed setContext leaves the previous context unchanged', () => {
    const wf = createWorkflow({ name: 'range-check-4' })
      .setContext(z.object({ level: z.number().min(1).max(10) }))
      .defineAction('GO', Empty)
      .addStep('a').addStep('b')
      .setInitial('a').setTerminal(['b'])
      .addTransition({ from: 'a', to: 'b', on: 'GO' })
      .build();

    const inst = wf.createInstance('rt-004', { level: 5 });
    expect(() =>
      (inst.setContext as (ctx: unknown) => unknown)({ level: 11 }),
    ).toThrow();
    expect(inst.getContext()).toEqual({ level: 5 });
  });
});

// ─── type safety ─────────────────────────────────────────────────────────────

describe('context — compile-time type safety', () => {
  it('createInstance rejects wrong context shape at compile time', () => {
    const wf = makeApprovalWf();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    function _typeOnly() {
      // @ts-expect-error — score must be a number, not a string
      wf.createInstance('t-001', { isDutyManager: true, score: 'high' });
    }
    expect(wf).toBeDefined();
  });

  it('setContext rejects wrong context shape at compile time', () => {
    const wf = makeApprovalWf();
    const inst = wf.createInstance('t-002', { isDutyManager: false, score: 0 });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    function _typeOnly() {
      // @ts-expect-error — isDutyManager must be boolean
      inst.setContext({ isDutyManager: 'yes', score: 80 });
    }
    expect(inst).toBeDefined();
  });

  it('createInstance requires context when setContext was called on the builder', () => {
    const wf = makeApprovalWf();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    function _typeOnly() {
      // @ts-expect-error — context is required when a schema was declared
      wf.createInstance('t-003');
    }
    expect(wf).toBeDefined();
  });

  it('createInstance does not require context when no schema was declared', () => {
    const wf = createWorkflow({ name: 'no-ctx-2' })
      .defineAction('GO', Empty)
      .addStep('a').addStep('b')
      .setInitial('a').setTerminal(['b'])
      .addTransition({ from: 'a', to: 'b', on: 'GO' })
      .build();
    // no @ts-expect-error — context is optional here
    expect(() => wf.createInstance('t-004')).not.toThrow();
  });
});
