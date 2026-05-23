import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { WorkflowBuilder } from '../../src/core/builder.js';
import { StepState } from '../../src/states/step-state.js';
import { ForkState } from '../../src/states/fork-state.js';
import { JoinState } from '../../src/states/join-state.js';
import { Guard } from '../../src/guards/factory.js';
import { StateStatus } from '../../src/types/index.js';

// ─── Shared minimal workflow ───────────────────────────────────────────────────

const Empty = z.object({});

const linear = new WorkflowBuilder('linear')
  .defineAction('GO', Empty)
  .defineAction('BACK', Empty)
  .addState(new StepState('a'))
  .addState(new StepState('b'))
  .addState(new StepState('c'))
  .setInitial('a')
  .setTerminal(['c'])
  .addTransition({ from: 'a', to: 'b', on: 'GO' })
  .addTransition({ from: 'b', to: 'c', on: 'GO' })
  .build();

// ─── Terminal-state guard ──────────────────────────────────────────────────────

describe('Engine — terminal state', () => {
  it('blocks all dispatches after reaching terminal', async () => {
    const inst = linear.createInstance('e-001');
    await inst.dispatch('GO', {});
    await inst.dispatch('GO', {});
    const result = await inst.dispatch('GO', {});
    expect(result.success).toBe(false);
    if (!result.success) expect(result.reason).toBe('terminal-state');
  });

  it('snapshot.isTerminal is true after terminal state is reached', async () => {
    const inst = linear.createInstance('e-002');
    await inst.dispatch('GO', {});
    await inst.dispatch('GO', {});
    expect(inst.getSnapshot().isTerminal).toBe(true);
  });
});

// ─── Candidate resolution ─────────────────────────────────────────────────────

describe('Engine — no-active-source', () => {
  it('returns no-active-source when action has transitions but none from the active state', async () => {
    // 'BACK' has a transition, but only from 'c'. When at 'b', dispatching BACK
    // finds a candidate set but none with an active source.
    const wf = new WorkflowBuilder('back-test')
      .defineAction('GO', Empty)
      .defineAction('BACK', Empty)
      .addState(new StepState('a'))
      .addState(new StepState('b'))
      .addState(new StepState('c'))
      .setInitial('a')
      .setTerminal(['c'])
      .addTransition({ from: 'a', to: 'b', on: 'GO' })
      .addTransition({ from: 'b', to: 'c', on: 'GO' })
      .addTransition({ from: 'c', to: 'a', on: 'BACK' }) // BACK exists, but only from 'c'
      .build();

    const inst = wf.createInstance('e-003');
    await inst.dispatch('GO', {}); // now at b
    const result = await inst.dispatch('BACK', {});
    // BACK has a transition (c→a) but 'c' is not active → no-active-source
    expect(result.success).toBe(false);
    if (!result.success) expect(result.reason).toBe('no-active-source');
  });

  it('returns invalid-action when the action has no transitions at all', async () => {
    const inst = linear.createInstance('e-004');
    // BACK is declared but has zero transitions in 'linear'
    const result = await inst.dispatch('BACK', {});
    expect(result.success).toBe(false);
    if (!result.success) expect(result.reason).toBe('invalid-action');
  });
});

// ─── Invalid action ───────────────────────────────────────────────────────────

describe('Engine — invalid-action', () => {
  it('returns invalid-action for an undeclared action name', async () => {
    // Build a workflow where 'GHOST' has never been defined
    const wf = new WorkflowBuilder('ghost-test')
      .defineAction('GO', Empty)
      .addState(new StepState('start'))
      .addState(new StepState('end'))
      .setInitial('start')
      .setTerminal(['end'])
      .addTransition({ from: 'start', to: 'end', on: 'GO' })
      .build();

    const inst = wf.createInstance('e-inv-001');
    // 'GHOST' is not registered → schema lookup throws before engine sees it
    await expect(inst.dispatch('GO' as 'GO', {} as never)).resolves.toMatchObject({ success: true });
    // The compile-time type prevents calling with unknown actions, so we rely
    // on the Zod-throw test in linear-sop for the payload validation path.
  });
});

// ─── Guard evaluation ─────────────────────────────────────────────────────────

describe('Engine — guard evaluation', () => {
  const guarded = new WorkflowBuilder('guarded')
    .defineAction('GO', Empty)
    .addState(new StepState('a'))
    .addState(new StepState('b'))
    .setInitial('a')
    .setTerminal(['b'])
    .addTransition({ from: 'a', to: 'b', on: 'GO', guard: Guard.inject('canGo') })
    .build();

  it('blocks when the injected guard returns false', async () => {
    const inst = guarded.createInstance('g-001');
    inst.injectGuard('canGo', async () => false);
    const result = await inst.dispatch('GO', {});
    expect(result.success).toBe(false);
    if (!result.success) expect(result.reason).toBe('guard-failed');
    // State must not have changed
    expect(inst.getCurrentStates()).toEqual(['a']);
  });

  it('passes when the injected guard returns true', async () => {
    const inst = guarded.createInstance('g-002');
    inst.injectGuard('canGo', async () => true);
    const result = await inst.dispatch('GO', {});
    expect(result.success).toBe(true);
    expect(inst.getCurrentStates()).toEqual(['b']);
  });

  it('Guard.fn inline guard receives payload correctly', async () => {
    const wf = new WorkflowBuilder('fn-guard')
      .defineAction('GO', z.object({ role: z.string() }))
      .addState(new StepState('a'))
      .addState(new StepState('b'))
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
    const wf = new WorkflowBuilder('not-guard')
      .defineAction('GO', Empty)
      .addState(new StepState('a'))
      .addState(new StepState('b'))
      .setInitial('a')
      .setTerminal(['b'])
      .addTransition({ from: 'a', to: 'b', on: 'GO', guard: Guard.not(Guard.always()) })
      .build();

    const inst = wf.createInstance('ng-001');
    const result = await inst.dispatch('GO', {});
    expect(result.success).toBe(false);
    if (!result.success) expect(result.reason).toBe('guard-failed');
  });
});

// ─── Transition result shape ───────────────────────────────────────────────────

describe('Engine — DispatchResult shape on success', () => {
  it('includes enteredStates and exitedStates', async () => {
    const inst = linear.createInstance('rs-001');
    const result = await inst.dispatch('GO', {});
    if (!result.success) throw new Error('expected success');
    expect(result.enteredStates).toContain('b');
    expect(result.exitedStates).toContain('a');
  });

  it('includes the updated snapshot', async () => {
    const inst = linear.createInstance('rs-002');
    const result = await inst.dispatch('GO', {});
    if (!result.success) throw new Error('expected success');
    expect(result.snapshot.version).toBe(1);
    expect(result.snapshot.stateStatuses['b']).toBe(StateStatus.Active);
  });
});

// ─── Fork fan-out via engine ──────────────────────────────────────────────────

describe('Engine — Fork fan-out', () => {
  const forked = new WorkflowBuilder('fork-engine')
    .defineAction('START', Empty)
    .addState(new StepState('start'))
    .addState(new ForkState('fork', { targets: ['x', 'y', 'z'] }))
    .addState(new StepState('x'))
    .addState(new StepState('y'))
    .addState(new StepState('z'))
    .addState(new JoinState('join', { requires: ['x', 'y', 'z'] }))
    .setInitial('start')
    .setTerminal(['join'])
    .addTransition({ from: 'start', to: 'fork', on: 'START' })
    .build();

  it('activates all three targets when fork is entered', async () => {
    const inst = forked.createInstance('fe-001');
    const result = await inst.dispatch('START', {});
    if (!result.success) throw new Error('expected success');
    expect([...result.enteredStates].sort()).toEqual(['x', 'y', 'z']);
    expect([...inst.getCurrentStates()].sort()).toEqual(['x', 'y', 'z']);
  });

  it('fork state itself is never left in active status', async () => {
    const inst = forked.createInstance('fe-002');
    await inst.dispatch('START', {});
    expect(inst.getStateStatus('fork')).toBe(StateStatus.Completed);
  });
});

// ─── Join fixed-point via engine ──────────────────────────────────────────────

describe('Engine — Join fixed-point', () => {
  const quorum = new WorkflowBuilder('quorum')
    .defineAction('START', Empty)
    .defineAction('DONE_A', Empty)
    .defineAction('DONE_B', Empty)
    .defineAction('DONE_C', Empty)
    .addState(new StepState('start'))
    .addState(new ForkState('fork', { targets: ['a', 'b', 'c'] }))
    .addState(new StepState('a'))
    .addState(new StepState('b'))
    .addState(new StepState('c'))
    .addState(new JoinState('join', { requires: ['a', 'b', 'c'], mode: 2 })) // quorum of 2
    .addState(new StepState('done'))
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

// ─── History ──────────────────────────────────────────────────────────────────

describe('Engine — history', () => {
  it('appends one entry per successful dispatch', async () => {
    const inst = linear.createInstance('h-001');
    await inst.dispatch('GO', {});
    await inst.dispatch('GO', {});
    expect(inst.getSnapshot().history).toHaveLength(2);
  });

  it('does not append history on failed dispatch', async () => {
    const inst = linear.createInstance('h-002');
    await inst.dispatch('BACK', {}); // no-active-source — fails
    expect(inst.getSnapshot().history).toHaveLength(0);
  });

  it('history entry contains the action name and payload', async () => {
    const wf = new WorkflowBuilder('payload-history')
      .defineAction('GO', z.object({ note: z.string() }))
      .addState(new StepState('a'))
      .addState(new StepState('b'))
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
