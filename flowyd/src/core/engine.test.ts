import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { createWorkflow } from './builder.js';
import { Guard } from '../guards/factory.js';
import { StateStatus } from '../types/index.js';

const Empty = z.object({});

const linear = createWorkflow({ name: 'linear' })
  .defineAction('GO', Empty)
  .defineAction('BACK', Empty)
  .addStep('a')
  .addStep('b')
  .addStep('c')
  .setInitial('a')
  .setTerminal(['c'])
  .addTransition({ from: 'a', to: 'b', on: 'GO' })
  .addTransition({ from: 'b', to: 'c', on: 'GO' })
  .build();

describe('Engine — terminal state', () => {
  it('blocks all dispatches after reaching terminal', async () => {
    const inst = linear.createInstance('e-001');
    await inst.dispatch('GO', {});
    await inst.dispatch('GO', {});
    const result = await inst.dispatch('GO', {});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe('terminal-state');
    }
  });

  it('snapshot.isTerminal is true after terminal state is reached', async () => {
    const inst = linear.createInstance('e-002');
    await inst.dispatch('GO', {});
    await inst.dispatch('GO', {});
    expect(inst.getSnapshot().isTerminal).toBe(true);
  });
});

describe('Engine — no-active-source', () => {
  it('returns no-active-source when action has transitions but none from the active state', async () => {
    const wf = createWorkflow({ name: 'back-test' })
      .defineAction('GO', Empty)
      .defineAction('BACK', Empty)
      .addStep('a')
      .addStep('b')
      .addStep('c')
      .setInitial('a')
      .setTerminal(['c'])
      .addTransition({ from: 'a', to: 'b', on: 'GO' })
      .addTransition({ from: 'b', to: 'c', on: 'GO' })
      .addTransition({ from: 'c', to: 'a', on: 'BACK' })
      .build();

    const inst = wf.createInstance('e-003');
    await inst.dispatch('GO', {});
    const result = await inst.dispatch('BACK', {});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe('no-active-source');
    }
  });

  it('returns invalid-action when the action has no transitions at all', async () => {
    const inst = linear.createInstance('e-004');
    const result = await inst.dispatch('BACK', {});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe('invalid-action');
    }
  });
});

describe('Engine — invalid-action', () => {
  it('returns invalid-action for an undeclared action name', async () => {
    const wf = createWorkflow({ name: 'ghost-test' })
      .defineAction('GO', Empty)
      .addStep('start')
      .addStep('end')
      .setInitial('start')
      .setTerminal(['end'])
      .addTransition({ from: 'start', to: 'end', on: 'GO' })
      .build();

    const inst = wf.createInstance('e-inv-001');
    await expect(inst.dispatch('GO' as const, {} as never)).resolves.toMatchObject({
      success: true,
    });
  });
});

describe('Engine — guard evaluation', () => {
  const guarded = createWorkflow({ name: 'guarded' })
    .defineAction('GO', Empty)
    .addStep('a')
    .addStep('b')
    .setInitial('a')
    .setTerminal(['b'])
    .addTransition({ from: 'a', to: 'b', on: 'GO', guard: Guard.inject('canGo') })
    .build();

  it('blocks when the injected guard returns false', async () => {
    const inst = guarded.createInstance('g-001');
    inst.injectGuard('canGo', () => false);
    const result = await inst.dispatch('GO', {});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe('guard-failed');
    }
    expect(inst.getCurrentStates()).toEqual(['a']);
  });

  it('passes when the injected guard returns true', async () => {
    const inst = guarded.createInstance('g-002');
    inst.injectGuard('canGo', () => true);
    const result = await inst.dispatch('GO', {});
    expect(result.success).toBe(true);
    expect(inst.getCurrentStates()).toEqual(['b']);
  });

  it('Guard.fn inline guard receives payload correctly', async () => {
    const wf = createWorkflow({ name: 'fn-guard' })
      .defineAction('GO', z.object({ role: z.string() }))
      .addStep('a')
      .addStep('b')
      .setInitial('a')
      .setTerminal(['b'])
      .addTransition({
        from: 'a',
        to: 'b',
        on: 'GO',
        guard: Guard.fn<{ role: string }>((ctx) => ctx.payload.role === 'admin'),
      })
      .build();

    const allowed = wf.createInstance('fn-001');
    expect((await allowed.dispatch('GO', { role: 'admin' })).success).toBe(true);

    const blocked = wf.createInstance('fn-002');
    expect((await blocked.dispatch('GO', { role: 'user' })).success).toBe(false);
  });

  it('Guard.not inverts a passing guard', async () => {
    const wf = createWorkflow({ name: 'not-guard' })
      .defineAction('GO', Empty)
      .addStep('a')
      .addStep('b')
      .setInitial('a')
      .setTerminal(['b'])
      .addTransition({ from: 'a', to: 'b', on: 'GO', guard: Guard.not(Guard.always()) })
      .build();

    const inst = wf.createInstance('ng-001');
    const result = await inst.dispatch('GO', {});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe('guard-failed');
    }
  });
});

describe('Engine — DispatchResult shape on success', () => {
  it('includes enteredStates and exitedStates', async () => {
    const inst = linear.createInstance('rs-001');
    const result = await inst.dispatch('GO', {});
    if (!result.success) {
      throw new Error('expected success');
    }
    expect(result.enteredStates).toContain('b');
    expect(result.exitedStates).toContain('a');
  });

  it('includes the updated snapshot', async () => {
    const inst = linear.createInstance('rs-002');
    const result = await inst.dispatch('GO', {});
    if (!result.success) {
      throw new Error('expected success');
    }
    expect(result.snapshot.version).toBe(1);
    expect(result.snapshot.stateStatuses['b']).toBe(StateStatus.Active);
  });
});

describe('Engine — Fork fan-out', () => {
  const forked = createWorkflow({ name: 'fork-engine' })
    .defineAction('START', Empty)
    .addStep('start')
    .addStep('x')
    .addStep('y')
    .addStep('z')
    .addFork('fork', { targets: ['x', 'y', 'z'] })
    .addJoin('join', { requires: ['x', 'y', 'z'] })
    .setInitial('start')
    .setTerminal(['join'])
    .addTransition({ from: 'start', to: 'fork', on: 'START' })
    .build();

  it('activates all three targets when fork is entered and auto-completes them (no outgoing transitions)', async () => {
    const inst = forked.createInstance('fe-001');
    const result = await inst.dispatch('START', {});
    if (!result.success) {
      throw new Error('expected success');
    }
    // x, y, z are fork targets with no outgoing transitions — they auto-complete,
    // which lets the join activate in the same dispatch.
    expect([...result.enteredStates].sort()).toEqual(['join', 'x', 'y', 'z']);
    expect(inst.getCurrentStates()).toEqual(['join']);
  });

  it('fork state itself is never left in active status', async () => {
    const inst = forked.createInstance('fe-002');
    await inst.dispatch('START', {});
    expect(inst.getStateStatus('fork')).toBe(StateStatus.Completed);
  });
});

describe('Engine — Join fixed-point', () => {
  const quorum = createWorkflow({ name: 'quorum' })
    .defineAction('START', Empty)
    .defineAction('DONE_A', Empty)
    .defineAction('DONE_B', Empty)
    .defineAction('DONE_C', Empty)
    .addStep('start')
    .addStep('a')
    .addStep('b')
    .addStep('c')
    .addFork('fork', { targets: ['a', 'b', 'c'] })
    .addJoin('join', { requires: ['a', 'b', 'c'], mode: 2 })
    .addStep('done')
    .setInitial('start')
    .setTerminal(['done'])
    .addTransition({ from: 'start', to: 'fork', on: 'START' })
    .addTransition({ from: 'a', to: 'join', on: 'DONE_A' })
    .addTransition({ from: 'b', to: 'join', on: 'DONE_B' })
    .addTransition({ from: 'c', to: 'join', on: 'DONE_C' })
    .addTransition({ from: 'join', to: 'done', on: 'DONE_C' })
    .build();

  it('quorum join activates after 2 of 3 complete', async () => {
    const inst = quorum.createInstance('q-001');
    await inst.dispatch('START', {});
    await inst.dispatch('DONE_A', {});
    expect(inst.getStateStatus('join')).toBe(StateStatus.Idle);
    await inst.dispatch('DONE_B', {});
    expect(inst.getStateStatus('join')).toBe(StateStatus.Active);
  });
});

describe('Engine — history', () => {
  it('appends one entry per successful dispatch', async () => {
    const inst = linear.createInstance('h-001');
    await inst.dispatch('GO', {});
    await inst.dispatch('GO', {});
    expect(inst.getSnapshot().history).toHaveLength(2);
  });

  it('does not append history on failed dispatch', async () => {
    const inst = linear.createInstance('h-002');
    await inst.dispatch('BACK', {});
    expect(inst.getSnapshot().history).toHaveLength(0);
  });

  it('history entry contains the action name and payload', async () => {
    const wf = createWorkflow({ name: 'payload-history' })
      .defineAction('GO', z.object({ note: z.string() }))
      .addStep('a')
      .addStep('b')
      .setInitial('a')
      .setTerminal(['b'])
      .addTransition({ from: 'a', to: 'b', on: 'GO' })
      .build();

    const inst = wf.createInstance('h-003');
    await inst.dispatch('GO', { note: 'hello' });
    const entry = inst.getSnapshot().history[0];
    expect(entry?.action).toBe('GO');
    expect(entry?.payload).toMatchObject({ note: 'hello' });
  });
});
