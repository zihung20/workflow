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
    // Cast bypasses TStates to exercise the runtime guard for dynamic/untyped callers.
    expect(() => inst.getStateStatus('nonexistent' as 'a' | 'b')).toThrow('"nonexistent"');
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
    await inst.dispatch('GO', {}); // version 1, context was { step: 1 }
    inst.setContext({ step: 2 });
    await inst.dispatch('GO', {}); // version 2, context was { step: 2 }

    expect(inst.rewind(1).context).toEqual({ step: 1 });
    expect(inst.rewind(2).context).toEqual({ step: 2 });
  });
});

function makeFork() {
  return createWorkflow({ name: 'fork-wf' })
    .defineAction('START', Empty)
    .defineAction('DONE_A', Empty)
    .defineAction('DONE_B', Empty)
    .defineAction('FINISH', Empty)
    .addStep('start')
    .addStep('branch-a')
    .addStep('branch-b')
    .addFork('fork', { targets: ['branch-a', 'branch-b'] })
    .addJoin('join', { requires: ['branch-a', 'branch-b'], mode: 'all' })
    .addStep('end')
    .setInitial('start')
    .setTerminal(['end'])
    .addTransition({ from: 'start', to: 'fork', on: 'START' })
    .addTransition({ from: 'branch-a', to: 'join', on: 'DONE_A' })
    .addTransition({ from: 'branch-b', to: 'join', on: 'DONE_B' })
    .addTransition({ from: 'join', to: 'end', on: 'FINISH' })
    .build();
}

describe('WorkflowInstance — rewind (delta replay)', () => {
  it('rewind replays a WaitState as Waiting', async () => {
    const wf = makeWait();
    const inst = wf.createInstance('rw-w-001');
    await inst.dispatch('START', {});
    // at version 1: sub is waiting
    const at1 = inst.rewind(1);
    expect(at1.stateStatuses['sub']).toBe(StateStatus.Waiting);
    expect(at1.stateStatuses['start']).toBe(StateStatus.Completed);
    expect(at1.stateStatuses['end']).toBe(StateStatus.Idle);
  });

  it('rewind replays resolveWait as Active (not Waiting)', async () => {
    const wf = makeWait();
    const inst = wf.createInstance('rw-w-002');
    await inst.dispatch('START', {}); // v1: sub=Waiting
    inst.resolveWait('sub'); // v2: sub=Active
    const at2 = inst.rewind(2);
    expect(at2.stateStatuses['sub']).toBe(StateStatus.Active);
  });

  it('rewind to version before resolveWait still shows Waiting', async () => {
    const wf = makeWait();
    const inst = wf.createInstance('rw-w-003');
    await inst.dispatch('START', {});
    inst.resolveWait('sub');
    const at1 = inst.rewind(1);
    expect(at1.stateStatuses['sub']).toBe(StateStatus.Waiting);
  });

  it('rewind correctly replays parallel branches mid-execution', async () => {
    const wf = makeFork();
    const inst = wf.createInstance('rw-f-001');
    await inst.dispatch('START', {}); // v1: branch-a and branch-b both active
    await inst.dispatch('DONE_A', {}); // v2: branch-a completed, join still idle

    const at1 = inst.rewind(1);
    expect(at1.stateStatuses['branch-a']).toBe(StateStatus.Active);
    expect(at1.stateStatuses['branch-b']).toBe(StateStatus.Active);
    expect(at1.stateStatuses['join']).toBe(StateStatus.Idle);

    const at2 = inst.rewind(2);
    expect(at2.stateStatuses['branch-a']).toBe(StateStatus.Completed);
    expect(at2.stateStatuses['branch-b']).toBe(StateStatus.Active);
    expect(at2.stateStatuses['join']).toBe(StateStatus.Idle);
  });

  it('rewind shows join as Active only after all branches complete', async () => {
    const wf = makeFork();
    const inst = wf.createInstance('rw-f-002');
    await inst.dispatch('START', {});
    await inst.dispatch('DONE_A', {});
    await inst.dispatch('DONE_B', {}); // v3: join becomes Active

    const at3 = inst.rewind(3);
    expect(at3.stateStatuses['join']).toBe(StateStatus.Active);
    expect(at3.stateStatuses['branch-a']).toBe(StateStatus.Completed);
    expect(at3.stateStatuses['branch-b']).toBe(StateStatus.Completed);
  });

  it('unreached states are Idle in any rewound version', async () => {
    const wf = makeThreeStep();
    const inst = wf.createInstance('rw-idle-001');
    await inst.dispatch('NEXT', {}); // a→b; c still idle

    const at1 = inst.rewind(1);
    expect(at1.stateStatuses['c']).toBe(StateStatus.Idle);
  });
});

describe('WorkflowInstance — typed dispatch result (TStates)', () => {
  it('enteredStates contains the state that became active', async () => {
    const wf = makeLinear();
    const inst = wf.createInstance('dr-001');
    const result = await inst.dispatch('GO', {});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.enteredStates).toContain('b');
      expect(result.exitedStates).toContain('a');
    }
  });

  it('exitedStates contains the source state that was completed', async () => {
    const wf = makeThreeStep();
    const inst = wf.createInstance('dr-002');
    const result = await inst.dispatch('NEXT', {});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.exitedStates).toEqual(['a']);
      expect(result.enteredStates).toEqual(['b']);
    }
  });

  it('enteredStates includes all parallel branches after a fork', async () => {
    const wf = makeFork();
    const inst = wf.createInstance('dr-003');
    const result = await inst.dispatch('START', {});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.enteredStates).toContain('branch-a');
      expect(result.enteredStates).toContain('branch-b');
    }
  });

  it('enteredStates includes join when it auto-activates', async () => {
    const wf = makeFork();
    const inst = wf.createInstance('dr-004');
    await inst.dispatch('START', {});
    await inst.dispatch('DONE_A', {});
    const result = await inst.dispatch('DONE_B', {});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.enteredStates).toContain('join');
    }
  });

  it('blocked result activeStates lists currently active states', async () => {
    const wf = makeLinear();
    const inst = wf.createInstance('dr-005');
    // Dispatch an action with no matching transition from the current state
    const result = await inst.dispatch('GO', {});
    // Now terminal — next dispatch must block
    expect(result.success).toBe(true);
    const blocked = await inst.dispatch('GO', {});
    expect(blocked.success).toBe(false);
    if (!blocked.success) {
      expect(blocked.activeStates).toContain('b');
    }
  });

  it('enteredStates and exitedStates typed as TStates[] — compile-time check', () => {
    const inst = makeLinear().createInstance('dr-ct-001');
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async function _typeOnly() {
      const result = await inst.dispatch('GO', {});
      if (result.success) {
        // 'a' and 'b' are the only valid TStates — this must compile
        const _entered: ('a' | 'b')[] = [...result.enteredStates];
        const _exited: ('a' | 'b')[] = [...result.exitedStates];
        // @ts-expect-error 'unknown-state' is not a registered state ID
        const _bad: ('a' | 'b')[] = ['unknown-state'];
        void _entered;
        void _exited;
        void _bad;
      }
    }
    expect(inst).toBeDefined();
  });

  it('activeStates in TransitionBlocked typed as TStates[] — compile-time check', () => {
    const inst = makeLinear().createInstance('dr-ct-002');
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async function _typeOnly() {
      const result = await inst.dispatch('GO', {});
      if (!result.success) {
        const _active: ('a' | 'b')[] = [...result.activeStates];
        void _active;
      }
    }
    expect(inst).toBeDefined();
  });

  it('action field on result is typed as the dispatched action literal — compile-time check', () => {
    const inst = makeLinear().createInstance('dr-ct-003');
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async function _typeOnly() {
      const result = await inst.dispatch('GO', {});
      // result.action must be typed as 'GO', not just string
      const _action: 'GO' = result.action;
      // @ts-expect-error 'OTHER' is not the dispatched action
      const _bad: 'OTHER' = result.action;
      void _action;
      void _bad;
    }
    expect(inst).toBeDefined();
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
