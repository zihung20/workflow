import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { createWorkflow } from './builder.js';
import { StateStatus } from '../types/index.js';

const Empty = z.object({});

function makeLinear() {
  return createWorkflow({ name: 'linear', states: ['a', 'b'] })
    .defineAction('GO', Empty)
    .addStep('a')
    .addStep('b')
    .setInitial('a')
    .setTerminal(['b'])
    .addTransition({ from: 'a', to: 'b', on: 'GO' })
    .build();
}

function makeWait() {
  return createWorkflow({ name: 'wait-wf', states: ['start', 'sub', 'end'] })
    .defineAction('START', Empty)
    .defineAction('DONE', Empty)
    .addStep('start')
    .addWait('sub', { externalName: 'external' })
    .addStep('end')
    .setInitial('start')
    .setTerminal(['end'])
    .addTransition({ from: 'start', to: 'sub', on: 'START' })
    .addTransition({ from: 'sub', to: 'end', on: 'DONE' })
    .build();
}

describe('WorkflowInstance — snapshot round-trip', () => {
  it('getSnapshot() returns a deep copy', () => {
    const wf = makeLinear();
    const inst = wf.createInstance('i-001');
    const snap = inst.getSnapshot();
    const json = JSON.parse(JSON.stringify(snap)) as typeof snap;
    expect(json.instanceId).toBe('i-001');
    expect(json.version).toBe(0);
    expect(json.isTerminal).toBe(false);
    expect(json.history).toHaveLength(0);
  });

  it('mutating the returned snapshot does not affect the live instance', () => {
    const wf = makeLinear();
    const inst = wf.createInstance('i-002');
    const snap = inst.getSnapshot();
    // Force-mutate the returned copy
    (snap as { version: number }).version = 999;
    // Live instance is unaffected
    expect(inst.getSnapshot().version).toBe(0);
  });
});

describe('WorkflowInstance — getAvailableTransitions', () => {
  it('returns actions reachable from the currently active state', () => {
    const wf = makeLinear();
    const inst = wf.createInstance('t-001');
    expect(inst.getAvailableTransitions()).toEqual(['GO']);
  });

  it('returns empty after reaching a terminal state', async () => {
    const wf = makeLinear();
    const inst = wf.createInstance('t-002');
    await inst.dispatch('GO', {});
    // 'b' is terminal — no further transitions defined
    expect(inst.getAvailableTransitions()).toEqual([]);
  });
});

describe('WorkflowInstance — canExecute dry-run', () => {
  it('returns true when the action would succeed', async () => {
    const wf = makeLinear();
    const inst = wf.createInstance('c-001');
    expect(await inst.canExecute('GO', {})).toBe(true);
  });

  it('does not advance the instance on canExecute', async () => {
    const wf = makeLinear();
    const inst = wf.createInstance('c-002');
    await inst.canExecute('GO', {});
    expect(inst.getSnapshot().version).toBe(0);
    expect(inst.getStateStatus('a')).toBe(StateStatus.Active);
  });

  it('returns false when a guard blocks', async () => {
    const wf = createWorkflow({ name: 'guarded', states: ['a', 'b'] })
      .defineAction('GO', Empty)
      .addStep('a')
      .addStep('b')
      .setInitial('a')
      .setTerminal(['b'])
      .addTransition({ from: 'a', to: 'b', on: 'GO', guard: () => false })
      .build();

    const inst = wf.createInstance('c-003');
    expect(await inst.canExecute('GO', {})).toBe(false);
    expect(inst.getSnapshot().version).toBe(0);
  });
});

describe('WorkflowInstance — getStateStatus', () => {
  it('throws for an unregistered state id', () => {
    const wf = makeLinear();
    const inst = wf.createInstance('ss-001');
    expect(() => inst.getStateStatus('nonexistent')).toThrow('"nonexistent"');
  });

  it('returns Idle for states not yet reached', () => {
    const wf = makeLinear();
    const inst = wf.createInstance('ss-002');
    expect(inst.getStateStatus('b')).toBe(StateStatus.Idle);
  });
});

describe('WorkflowInstance — resolveWait', () => {
  it('transitions a waiting WaitState to active', async () => {
    const wf = makeWait();
    const inst = wf.createInstance('sw-001');
    await inst.dispatch('START', {});
    expect(inst.getStateStatus('sub')).toBe(StateStatus.Waiting);
    inst.resolveWait('sub');
    expect(inst.getStateStatus('sub')).toBe(StateStatus.Active);
  });

  it('throws when stateId is not a WaitState', () => {
    const wf = makeWait();
    const inst = wf.createInstance('sw-002');
    expect(() => inst.resolveWait('start')).toThrow('WaitState');
  });

  it('throws when the WaitState is not in waiting status', () => {
    const wf = makeWait();
    const inst = wf.createInstance('sw-003');
    // 'sub' is still idle (START not dispatched yet)
    expect(() => inst.resolveWait('sub')).toThrow('not waiting');
  });

  it('increments version and appends history on resolve', async () => {
    const wf = makeWait();
    const inst = wf.createInstance('sw-004');
    await inst.dispatch('START', {});
    inst.resolveWait('sub');
    expect(inst.getSnapshot().version).toBe(2);
    expect(inst.getSnapshot().history).toHaveLength(2);
  });
});
