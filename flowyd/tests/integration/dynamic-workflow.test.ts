import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { createDynamicWorkflow } from '../../src/core/builder.js';

function buildLinearChain(stateIds: string[]) {
  if (stateIds.length < 2) {
    throw new Error('need at least 2 states');
  }

  const builder = createDynamicWorkflow({ name: 'dynamic-linear' });
  builder.defineAction('NEXT', z.object({}));

  for (const id of stateIds) {
    builder.addStep(id);
  }

  // noUncheckedIndexedAccess: guard guarantees length >= 2, so these are safe.
  builder.setInitial(stateIds[0]!);
  builder.setTerminal([stateIds[stateIds.length - 1]!]);

  for (let i = 0; i < stateIds.length - 1; i++) {
    builder.addTransition({ from: stateIds[i]!, to: stateIds[i + 1]!, on: 'NEXT' });
  }

  return builder.build();
}

/**
 * Build a fan-out / fan-in workflow at runtime:
 *   start → fork → [branch-0 … branch-N] → join → end
 *
 * Each branch completes on its own `DONE_<i>` action. State IDs and action
 * names are computed in a loop, so createDynamicWorkflow is used throughout.
 */
function buildParallelBranches(branchCount: number) {
  const branches = Array.from({ length: branchCount }, (_, i) => `branch-${i}`);
  const builder = createDynamicWorkflow({ name: 'dynamic-parallel' });

  builder.defineAction('START', z.object({}));
  builder.defineAction('COMPLETE_ALL', z.object({}));

  for (let i = 0; i < branchCount; i++) {
    builder.defineAction(`DONE_${i}`, z.object({}));
  }

  builder.addStep('start').addFork('fork', { targets: branches as [string, ...string[]] });

  for (const b of branches) {
    builder.addStep(b);
  }

  builder
    .addJoin('join', { requires: branches as [string, ...string[]], mode: 'all' })
    .addStep('end')
    .setInitial('start')
    .setTerminal(['end'])
    .addTransition({ from: 'start', to: 'fork', on: 'START' })
    .addTransition({ from: 'join', to: 'end', on: 'COMPLETE_ALL' });

  for (let i = 0; i < branchCount; i++) {
    builder.addTransition({ from: `branch-${i}`, to: 'join', on: `DONE_${i}` });
  }

  return builder.build();
}

// ---------------------------------------------------------------------------
// createDynamicWorkflow factory
// ---------------------------------------------------------------------------

describe('createDynamicWorkflow factory', () => {
  it('throws on an empty name', () => {
    expect(() => createDynamicWorkflow({ name: '' })).toThrow('non-empty');
  });

  it('throws on a whitespace-only name', () => {
    expect(() => createDynamicWorkflow({ name: '   ' })).toThrow('non-empty');
  });

  it('builds a valid workflow from runtime-supplied IDs without any cast', () => {
    const ids: string[] = ['alpha', 'beta', 'gamma'];
    const builder = createDynamicWorkflow({ name: 'no-cast' });
    builder.defineAction('NEXT', z.object({}));
    for (const id of ids) {
      builder.addStep(id);
    }
    builder.setInitial(ids[0]!).setTerminal([ids[2]!]);
    builder.addTransition({ from: 'alpha', to: 'beta', on: 'NEXT' });
    builder.addTransition({ from: 'beta', to: 'gamma', on: 'NEXT' });
    expect(() => builder.build()).not.toThrow();
  });

  it('accepts addWait in a dynamic loop', () => {
    const waitIds = ['wait-a', 'wait-b'];
    const builder = createDynamicWorkflow({ name: 'dynamic-waits' });
    builder.defineAction('RESUME', z.object({}));
    for (const id of waitIds) {
      builder.addWait(id, { externalName: id });
    }
    builder.setInitial('wait-a').setTerminal(['wait-b']);
    builder.addTransition({ from: 'wait-a', to: 'wait-b', on: 'RESUME' });
    expect(() => builder.build()).not.toThrow();
  });

  it('produces a workflow whose instance starts at the initial state', () => {
    const builder = createDynamicWorkflow({ name: 'start-check' });
    builder.defineAction('GO', z.object({}));
    builder.addStep('begin').addStep('finish');
    builder.setInitial('begin').setTerminal(['finish']);
    builder.addTransition({ from: 'begin', to: 'finish', on: 'GO' });
    const wf = builder.build();
    const inst = wf.createInstance('sc-001');
    expect(inst.getCurrentStates()).toEqual(['begin']);
  });

  it('produces identical runtime behaviour to the explicit-cast approach', async () => {
    const builder = createDynamicWorkflow({ name: 'parity' });
    builder.defineAction('NEXT', z.object({}));
    builder.addStep('x').addStep('y').addStep('z');
    builder.setInitial('x').setTerminal(['z']);
    builder.addTransition({ from: 'x', to: 'y', on: 'NEXT' });
    builder.addTransition({ from: 'y', to: 'z', on: 'NEXT' });
    const wf = builder.build();
    const inst = wf.createInstance('par-001');
    await inst.dispatch('NEXT', {});
    expect(inst.getCurrentStates()).toEqual(['y']);
    await inst.dispatch('NEXT', {});
    expect(inst.isTerminal()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Linear chain tests
// ---------------------------------------------------------------------------

describe('Dynamic linear chain', () => {
  it('builds and traverses a 5-step chain end-to-end', async () => {
    const states = ['s0', 's1', 's2', 's3', 's4'];
    const wf = buildLinearChain(states);
    const inst = wf.createInstance('dyn-001');

    expect(inst.getCurrentStates()).toEqual(['s0']);

    for (let i = 0; i < states.length - 1; i++) {
      const result = await inst.dispatch('NEXT', {});
      expect(result.success).toBe(true);
    }

    expect(inst.getCurrentStates()).toEqual(['s4']);
    expect(inst.isTerminal()).toBe(true);
  });

  it('builds a 2-state (minimum) chain', async () => {
    const wf = buildLinearChain(['alpha', 'omega']);
    const inst = wf.createInstance('dyn-002');
    const result = await inst.dispatch('NEXT', {});
    expect(result.success).toBe(true);
    expect(inst.isTerminal()).toBe(true);
  });

  it('builds a 20-state chain without errors', () => {
    const states = Array.from({ length: 20 }, (_, i) => `step-${i}`);
    expect(() => buildLinearChain(states)).not.toThrow();
  });

  it('advances one step at a time', async () => {
    const wf = buildLinearChain(['a', 'b', 'c']);
    const inst = wf.createInstance('dyn-003');
    await inst.dispatch('NEXT', {}); // a → b
    expect(inst.getCurrentStates()).toEqual(['b']);
    await inst.dispatch('NEXT', {}); // b → c
    expect(inst.getCurrentStates()).toEqual(['c']);
  });

  it('rejects dispatch once the terminal state is reached', async () => {
    const wf = buildLinearChain(['start', 'end']);
    const inst = wf.createInstance('dyn-004');
    await inst.dispatch('NEXT', {});
    const result = await inst.dispatch('NEXT', {});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe('terminal-state');
    }
  });

  it('snapshot round-trip preserves position mid-chain', async () => {
    const states = ['p0', 'p1', 'p2', 'p3'];
    const wf = buildLinearChain(states);
    const inst = wf.createInstance('dyn-005');
    await inst.dispatch('NEXT', {}); // p0 → p1
    await inst.dispatch('NEXT', {}); // p1 → p2

    const snap = inst.getSnapshot();
    const restored = wf.restoreInstance(snap);
    expect(restored.getCurrentStates()).toEqual(['p2']);

    const result = await restored.dispatch('NEXT', {});
    expect(result.success).toBe(true);
    expect(restored.getCurrentStates()).toEqual(['p3']);
    expect(restored.isTerminal()).toBe(true);
  });

  it('snapshot history length matches number of dispatches', async () => {
    const wf = buildLinearChain(['x', 'y', 'z']);
    const inst = wf.createInstance('dyn-006');
    await inst.dispatch('NEXT', {});
    await inst.dispatch('NEXT', {});
    expect(inst.getSnapshot().history).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Runtime validation — build() is the safety net for dynamic workflows
//
// With runtime string[] input, TypeScript cannot flag invalid state IDs at
// compile time. build() provides the only safety check for user-supplied data.
// ---------------------------------------------------------------------------

describe('Dynamic builder — runtime validation', () => {
  it('build() throws when a transition references an unregistered state', () => {
    const builder = createDynamicWorkflow({ name: 'bad-transition' });
    builder.defineAction('GO', z.object({}));
    builder.addStep('a').addStep('b').setInitial('a').setTerminal(['b']);
    builder.addTransition({ from: 'a', to: 'ghost', on: 'GO' });
    expect(() => builder.build()).toThrow('"ghost"');
  });

  it('build() throws when no initial state is set', () => {
    const builder = createDynamicWorkflow({ name: 'no-initial' });
    builder.defineAction('GO', z.object({}));
    builder.addStep('a').addStep('b').setTerminal(['b']);
    builder.addTransition({ from: 'a', to: 'b', on: 'GO' });
    expect(() => builder.build()).toThrow('initial state');
  });

  it('build() throws when no terminal state is set', () => {
    const builder = createDynamicWorkflow({ name: 'no-terminal' });
    builder.defineAction('GO', z.object({}));
    builder.addStep('a').addStep('b').setInitial('a');
    builder.addTransition({ from: 'a', to: 'b', on: 'GO' });
    expect(() => builder.build()).toThrow('terminal state');
  });

  it('build() throws when a fork target is not a registered state', () => {
    const builder = createDynamicWorkflow({ name: 'bad-fork' });
    builder.defineAction('GO', z.object({}));
    builder.addStep('start');
    builder.addFork('fork', { targets: ['missing-branch'] as [string, ...string[]] });
    builder.setInitial('start').setTerminal(['start']);
    builder.addTransition({ from: 'start', to: 'fork', on: 'GO' });
    expect(() => builder.build()).toThrow('"missing-branch"');
  });

  it('build() throws when a join requires an unregistered state', () => {
    const builder = createDynamicWorkflow({ name: 'bad-join' });
    builder.defineAction('GO', z.object({}));
    builder.addStep('start');
    builder.addJoin('join', { requires: ['phantom'] as [string, ...string[]] });
    builder.setInitial('start').setTerminal(['join']);
    builder.addTransition({ from: 'start', to: 'join', on: 'GO' });
    expect(() => builder.build()).toThrow('"phantom"');
  });
});

// ---------------------------------------------------------------------------
// Dynamic parallel branches (fan-out / fan-in)
// ---------------------------------------------------------------------------

describe('Dynamic parallel branches', () => {
  it('builds a 3-branch parallel workflow without errors', () => {
    expect(() => buildParallelBranches(3)).not.toThrow();
  });

  it('starts in the initial state', () => {
    const wf = buildParallelBranches(3);
    const inst = wf.createInstance('par-001');
    expect(inst.getCurrentStates()).toEqual(['start']);
  });

  it('activates all branches after the fork', async () => {
    const wf = buildParallelBranches(3);
    const inst = wf.createInstance('par-002');
    const result = await inst.dispatch('START', {});
    expect(result.success).toBe(true);
    const active = inst.getCurrentStates().sort();
    expect(active).toEqual(['branch-0', 'branch-1', 'branch-2'].sort());
  });

  it('reaches terminal after all branches complete (all mode)', async () => {
    const branchCount = 4;
    const wf = buildParallelBranches(branchCount);
    const inst = wf.createInstance('par-003');

    await inst.dispatch('START', {});

    for (let i = 0; i < branchCount; i++) {
      const result = await inst.dispatch(`DONE_${i}`, {});
      expect(result.success).toBe(true);
    }

    await inst.dispatch('COMPLETE_ALL', {});
    expect(inst.isTerminal()).toBe(true);
  });

  it('does not reach join until every branch completes', async () => {
    const wf = buildParallelBranches(3);
    const inst = wf.createInstance('par-004');
    await inst.dispatch('START', {});

    // Complete only 2 of 3 branches
    await inst.dispatch('DONE_0', {});
    await inst.dispatch('DONE_1', {});

    // join is not active yet, so COMPLETE_ALL has no source
    const result = await inst.dispatch('COMPLETE_ALL', {});
    expect(result.success).toBe(false);
    expect(inst.isTerminal()).toBe(false);
  });

  it('snapshot round-trip works mid-parallel execution', async () => {
    const wf = buildParallelBranches(3);
    const inst = wf.createInstance('par-005');
    await inst.dispatch('START', {});
    await inst.dispatch('DONE_0', {});

    const snap = inst.getSnapshot();
    const restored = wf.restoreInstance(snap);

    await restored.dispatch('DONE_1', {});
    await restored.dispatch('DONE_2', {});
    const r = await restored.dispatch('COMPLETE_ALL', {});
    expect(r.success).toBe(true);
    expect(restored.isTerminal()).toBe(true);
  });

  it('builds a single-branch parallel workflow (degenerate case)', async () => {
    const wf = buildParallelBranches(1);
    const inst = wf.createInstance('par-006');
    await inst.dispatch('START', {});
    await inst.dispatch('DONE_0', {});
    const r = await inst.dispatch('COMPLETE_ALL', {});
    expect(r.success).toBe(true);
    expect(inst.isTerminal()).toBe(true);
  });
});
