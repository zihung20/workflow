import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { createWorkflow } from './builder.js';
import { StateStatus } from '../types/index.js';

const Empty = z.object({});

function makeTyped() {
  return createWorkflow({ name: 'typed' })
    .defineAction('GO', z.object({ id: z.string() }))
    .defineAction('PING', Empty.strict())
    .addStep('a')
    .addStep('b')
    .setInitial('a')
    .setTerminal(['b'])
    .addTransition({ from: 'a', to: 'b', on: 'GO' })
    .build();
}

function makeLinear() {
  return createWorkflow({ name: 'linear' })
    .defineAction('GO', Empty)
    .addStep('a')
    .addStep('b')
    .setInitial('a')
    .setTerminal(['b'])
    .addTransition({ from: 'a', to: 'b', on: 'GO' })
    .build();
}

function makeWait() {
  return createWorkflow({ name: 'wait-wf' })
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

  it('each call returns a new independent copy', () => {
    const wf = makeLinear();
    const inst = wf.createInstance('i-002');
    const snap1 = inst.getSnapshot();
    const snap2 = inst.getSnapshot();
    expect(snap1).not.toBe(snap2);
    expect(snap1).toEqual(snap2);
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
    const wf = createWorkflow({ name: 'guarded' })
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

function makeThreeStep() {
  return createWorkflow({ name: 'three-step' })
    .defineAction('NEXT', Empty)
    .addStep('a')
    .addStep('b')
    .addStep('c')
    .setInitial('a')
    .setTerminal(['c'])
    .addTransition({ from: 'a', to: 'b', on: 'NEXT' })
    .addTransition({ from: 'b', to: 'c', on: 'NEXT' })
    .build();
}

describe('WorkflowInstance — rewind', () => {
  it('rewind(0) returns the initial state before any dispatches', async () => {
    const wf = makeLinear();
    const inst = wf.createInstance('rw-001');
    await inst.dispatch('GO', {});
    const rewound = inst.rewind(0);
    expect(rewound.version).toBe(0);
    expect(rewound.stateStatuses['a']).toBe(StateStatus.Active);
    expect(rewound.stateStatuses['b']).toBe(StateStatus.Idle);
    expect(rewound.isTerminal).toBe(false);
    expect(rewound.history).toHaveLength(0);
  });

  it('rewind(currentVersion) returns the same content as getSnapshot()', async () => {
    const wf = makeLinear();
    const inst = wf.createInstance('rw-002');
    await inst.dispatch('GO', {});
    expect(inst.rewind(1)).toEqual(inst.getSnapshot());
  });

  it('rewind(N) returns stateStatuses at version N', async () => {
    const wf = makeThreeStep();
    const inst = wf.createInstance('rw-003');
    await inst.dispatch('NEXT', {});
    await inst.dispatch('NEXT', {});

    const at1 = inst.rewind(1);
    expect(at1.version).toBe(1);
    expect(at1.stateStatuses['a']).toBe(StateStatus.Completed);
    expect(at1.stateStatuses['b']).toBe(StateStatus.Active);
    expect(at1.stateStatuses['c']).toBe(StateStatus.Idle);
    expect(at1.isTerminal).toBe(false);
    expect(at1.history).toHaveLength(1);
  });

  it('rewind(N) marks isTerminal correctly for terminal versions', async () => {
    const wf = makeThreeStep();
    const inst = wf.createInstance('rw-004');
    await inst.dispatch('NEXT', {});
    await inst.dispatch('NEXT', {});

    const at2 = inst.rewind(2);
    expect(at2.isTerminal).toBe(true);
    expect(at2.stateStatuses['c']).toBe(StateStatus.Active);
  });

  it('returned snapshot is a deep clone — mutations do not affect the live instance', async () => {
    const wf = makeLinear();
    const inst = wf.createInstance('rw-005');
    await inst.dispatch('GO', {});
    const rewound = inst.rewind(0);
    (rewound.stateStatuses as Record<string, StateStatus>)['a'] = StateStatus.Idle;
    expect(inst.getStateStatus('a')).toBe(StateStatus.Completed);
  });

  it('two calls to rewind(N) return equal but distinct objects', async () => {
    const wf = makeLinear();
    const inst = wf.createInstance('rw-006');
    await inst.dispatch('GO', {});
    const r1 = inst.rewind(0);
    const r2 = inst.rewind(0);
    expect(r1).toEqual(r2);
    expect(r1).not.toBe(r2);
  });

  it('throws for version below 0', () => {
    const wf = makeLinear();
    const inst = wf.createInstance('rw-007');
    expect(() => inst.rewind(-1)).toThrow('out of range');
  });

  it('throws for version above currentVersion', () => {
    const wf = makeLinear();
    const inst = wf.createInstance('rw-008');
    expect(() => inst.rewind(1)).toThrow('out of range');
  });

  it('rewind records context at each version', async () => {
    const wf = createWorkflow({ name: 'ctx-rw' })
      .setContext(z.object({ step: z.number() }))
      .defineAction('GO', Empty)
      .addStep('a')
      .addStep('b')
      .addStep('c')
      .setInitial('a')
      .setTerminal(['c'])
      .addTransition({ from: 'a', to: 'b', on: 'GO' })
      .addTransition({ from: 'b', to: 'c', on: 'GO' })
      .build();

    const inst = wf.createInstance('rw-ctx-001', { step: 1 });
    await inst.dispatch('GO', {});           // version 1, context was { step: 1 }
    inst.setContext({ step: 2 });
    await inst.dispatch('GO', {});           // version 2, context was { step: 2 }

    expect(inst.rewind(1).context).toEqual({ step: 1 });
    expect(inst.rewind(2).context).toEqual({ step: 2 });
  });
});

describe('WorkflowInstance — payload strictness', () => {
  // Type-only tests: the async helpers below are never called at runtime.
  // TypeScript still checks their bodies, so unused @ts-expect-error directives
  // would cause `pnpm typecheck` to fail — which is the guard we want.

  it('rejects extra properties on a keyed schema at compile time', () => {
    const inst = makeTyped().createInstance('ps-001');
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async function _typeOnly() {
      // @ts-expect-error 'extra' is not declared in the GO schema
      await inst.dispatch('GO', { id: 'abc', extra: 'bad' });
    }
    expect(inst).toBeDefined();
  });

  it('rejects extra properties on an empty schema at compile time', () => {
    const inst = makeTyped().createInstance('ps-002');
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async function _typeOnly() {
      // @ts-expect-error 'baboi' is not in the empty PING schema
      await inst.dispatch('PING', { baboi: 'ignore' });
    }
    expect(inst).toBeDefined();
  });

  it('rejects extra properties on canExecute at compile time', () => {
    const inst = makeTyped().createInstance('ps-003');
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async function _typeOnly() {
      // @ts-expect-error extra property must be rejected on canExecute too
      await inst.canExecute('GO', { id: 'abc', extra: 'bad' });
    }
    expect(inst).toBeDefined();
  });

  it('accepts exact payload shapes at compile time', () => {
    const inst = makeTyped().createInstance('ps-004');
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async function _typeOnly() {
      // These must compile without error
      await inst.dispatch('GO', { id: 'abc' });
      await inst.dispatch('PING', {});
      await inst.canExecute('GO', { id: 'abc' });
    }
    expect(inst).toBeDefined();
  });

  it('rejects extra properties at runtime via Zod strict()', async () => {
    const inst = makeTyped().createInstance('ps-005');
    // PING uses Empty.strict() — Zod throws at runtime even if you bypass the type
    await expect(
      // Force the call past the type system to test runtime behaviour
      (inst.dispatch as (a: string, p: unknown) => Promise<unknown>)('PING', { baboi: 'ignore' }),
    ).rejects.toThrow();
  });
});
