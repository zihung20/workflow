/**
 * End-to-end invariant tests.
 *
 * These tests exercise complete workflow lifecycles and assert system-wide
 * structural invariants that must hold regardless of which workflow is running:
 *  - version counter semantics
 *  - history accuracy
 *  - snapshot JSON round-trip fidelity
 *  - terminal-state rejection
 *  - available-transitions accuracy
 *  - WaitState full lifecycle
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { createWorkflow } from '../../src/core/builder.js';
import { StateStatus } from '../../src/types/index.js';

const Empty = z.object({});

// ─── Fixtures ────────────────────────────────────────────────────────────────

const linear = createWorkflow({ name: 'linear', states: ['s1', 's2', 's3'] })
  .defineAction('NEXT', Empty)
  .defineAction('SKIP', Empty)
  .addStep('s1')
  .addStep('s2')
  .addStep('s3')
  .setInitial('s1')
  .setTerminal(['s3'])
  .addTransition({ from: 's1', to: 's2', on: 'NEXT' })
  .addTransition({ from: 's2', to: 's3', on: 'NEXT' })
  .addTransition({ from: 's1', to: 's3', on: 'SKIP' })
  .build();

const parallel = createWorkflow({
  name: 'parallel',
  states: ['start', 'fork', 'a', 'b', 'join', 'end'],
})
  .defineAction('START', Empty)
  .defineAction('DONE_A', Empty)
  .defineAction('DONE_B', Empty)
  .defineAction('FINISH', Empty)
  .addStep('start')
  .addFork('fork', { targets: ['a', 'b'] })
  .addStep('a')
  .addStep('b')
  .addJoin('join', { requires: ['a', 'b'], mode: 'all' })
  .addStep('end')
  .setInitial('start')
  .setTerminal(['end'])
  .addTransition({ from: 'start', to: 'fork', on: 'START' })
  .addTransition({ from: 'a', to: 'join', on: 'DONE_A' })
  .addTransition({ from: 'b', to: 'join', on: 'DONE_B' })
  .addTransition({ from: 'join', to: 'end', on: 'FINISH' })
  .build();

const subWf = createWorkflow({ name: 'sub-wf', states: ['begin', 'external', 'done'] })
  .defineAction('ENTER', Empty)
  .defineAction('COMPLETE', Empty)
  .addStep('begin')
  .addWait('external', { externalName: 'child-process' })
  .addStep('done')
  .setInitial('begin')
  .setTerminal(['done'])
  .addTransition({ from: 'begin', to: 'external', on: 'ENTER' })
  .addTransition({ from: 'external', to: 'done', on: 'COMPLETE' })
  .build();

// ─── Version counter ──────────────────────────────────────────────────────────

describe('Invariant: version counter', () => {
  it('starts at 0', () => {
    expect(linear.createInstance('v-001').getSnapshot().version).toBe(0);
  });

  it('increments by exactly 1 per successful dispatch', async () => {
    const inst = linear.createInstance('v-002');
    await inst.dispatch('NEXT', {});
    expect(inst.getSnapshot().version).toBe(1);
    await inst.dispatch('NEXT', {});
    expect(inst.getSnapshot().version).toBe(2);
  });

  it('does not increment on a failed dispatch', async () => {
    const inst = linear.createInstance('v-003');
    // SKIP goes from s1 directly to s3 (terminal). After that, another NEXT fails.
    await inst.dispatch('SKIP', {});
    const vBefore = inst.getSnapshot().version;
    await inst.dispatch('NEXT', {}); // fails: terminal state
    expect(inst.getSnapshot().version).toBe(vBefore);
  });

  it('resolveWait also increments version', async () => {
    const inst = subWf.createInstance('v-004');
    await inst.dispatch('ENTER', {});
    const vBefore = inst.getSnapshot().version;
    inst.resolveWait('external');
    expect(inst.getSnapshot().version).toBe(vBefore + 1);
  });
});

// ─── History accuracy ─────────────────────────────────────────────────────────

describe('Invariant: history accuracy', () => {
  it('history length equals successful dispatch count', async () => {
    const inst = linear.createInstance('h-001');
    expect(inst.getSnapshot().history).toHaveLength(0);
    await inst.dispatch('NEXT', {});
    expect(inst.getSnapshot().history).toHaveLength(1);
    await inst.dispatch('NEXT', {});
    expect(inst.getSnapshot().history).toHaveLength(2);
  });

  it('failed dispatches are not recorded in history', async () => {
    const inst = linear.createInstance('h-002');
    await inst.dispatch('NEXT', {});
    await inst.dispatch('NEXT', {}); // reaches terminal
    const lenBeforeFail = inst.getSnapshot().history.length;
    await inst.dispatch('NEXT', {}); // fails — terminal
    expect(inst.getSnapshot().history).toHaveLength(lenBeforeFail);
  });

  it('each history entry carries correct action name and ISO timestamp', async () => {
    const inst = linear.createInstance('h-003');
    const before = Date.now();
    await inst.dispatch('NEXT', {});
    const after = Date.now();
    const entry = inst.getSnapshot().history[0];
    expect(entry?.action).toBe('NEXT');
    const ts = new Date(entry?.at ?? '').getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it('history captures entered and exited states', async () => {
    const inst = linear.createInstance('h-004');
    const result = await inst.dispatch('NEXT', {});
    if (!result.success) {
      throw new Error('expected success');
    }
    expect(result.exitedStates).toContain('s1');
    expect(result.enteredStates).toContain('s2');
  });
});

// ─── Snapshot JSON round-trip ─────────────────────────────────────────────────

describe('Invariant: snapshot serialization round-trip', () => {
  it('snapshot is JSON-serialisable and preserves all fields', async () => {
    const inst = linear.createInstance('snap-001');
    await inst.dispatch('NEXT', {});
    const snap = inst.getSnapshot();
    const json = JSON.parse(JSON.stringify(snap)) as typeof snap;

    expect(json.instanceId).toBe(snap.instanceId);
    expect(json.workflowName).toBe(snap.workflowName);
    expect(json.version).toBe(snap.version);
    expect(json.isTerminal).toBe(snap.isTerminal);
    expect(json.stateStatuses).toEqual(snap.stateStatuses);
    expect(json.history).toHaveLength(snap.history.length);
    expect(json.createdAt).toBe(snap.createdAt);
    expect(json.updatedAt).toBe(snap.updatedAt);
  });

  it('restoreInstance from a serialized snapshot produces identical behaviour', async () => {
    const inst1 = linear.createInstance('snap-002');
    await inst1.dispatch('NEXT', {});
    const snap = JSON.parse(JSON.stringify(inst1.getSnapshot())) as ReturnType<
      typeof inst1.getSnapshot
    >;

    const inst2 = linear.restoreInstance(snap);
    // Restored instance should be at state s2; dispatching NEXT should move to s3 (terminal)
    const result = await inst2.dispatch('NEXT', {});
    expect(result.success).toBe(true);
    expect(inst2.isTerminal()).toBe(true);
  });
});

// ─── Terminal state rejection ─────────────────────────────────────────────────

describe('Invariant: terminal state rejects all dispatches', () => {
  it('rejects any action after reaching terminal', async () => {
    const inst = linear.createInstance('term-001');
    await inst.dispatch('SKIP', {}); // direct to s3 (terminal)
    expect(inst.isTerminal()).toBe(true);

    const r1 = await inst.dispatch('NEXT', {});
    const r2 = await inst.dispatch('SKIP', {});
    expect(r1.success).toBe(false);
    expect(r2.success).toBe(false);
    if (!r1.success) {
      expect(r1.reason).toBe('terminal-state');
    }
    if (!r2.success) {
      expect(r2.reason).toBe('terminal-state');
    }
  });

  it('version does not change after terminal rejection', async () => {
    const inst = linear.createInstance('term-002');
    await inst.dispatch('SKIP', {});
    const vAtTerminal = inst.getSnapshot().version;
    await inst.dispatch('NEXT', {});
    expect(inst.getSnapshot().version).toBe(vAtTerminal);
  });
});

// ─── Available transitions accuracy ──────────────────────────────────────────

describe('Invariant: getAvailableTransitions', () => {
  it('lists only actions from currently active states', () => {
    const inst = linear.createInstance('at-001');
    // s1 is active; both NEXT and SKIP are defined from s1
    const transitions = inst.getAvailableTransitions().sort();
    expect(transitions).toEqual(['NEXT', 'SKIP']);
  });

  it('updates after a transition fires', async () => {
    const inst = linear.createInstance('at-002');
    await inst.dispatch('NEXT', {}); // moves to s2
    // From s2, only NEXT is defined
    expect(inst.getAvailableTransitions()).toEqual(['NEXT']);
  });

  it('returns empty when terminal', async () => {
    const inst = linear.createInstance('at-003');
    await inst.dispatch('SKIP', {}); // directly to s3 (terminal, no outgoing transitions)
    expect(inst.getAvailableTransitions()).toEqual([]);
  });

  it('lists actions for all concurrently active states after fork', async () => {
    const inst = parallel.createInstance('at-004');
    await inst.dispatch('START', {});
    // a and b are both active; DONE_A and DONE_B are both available
    const transitions = inst.getAvailableTransitions().sort();
    expect(transitions).toEqual(['DONE_A', 'DONE_B']);
  });
});

// ─── WaitState full lifecycle ─────────────────────────────────────────────────

describe('Invariant: WaitState full lifecycle', () => {
  it('sets WaitState to waiting on entry', async () => {
    const inst = subWf.createInstance('sw-001');
    await inst.dispatch('ENTER', {});
    expect(inst.getStateStatus('external')).toBe(StateStatus.Waiting);
  });

  it('cannot dispatch out while in waiting status', async () => {
    const inst = subWf.createInstance('sw-002');
    await inst.dispatch('ENTER', {});
    const result = await inst.dispatch('COMPLETE', {});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe('no-active-source');
    }
  });

  it('resolveWait promotes waiting → active', async () => {
    const inst = subWf.createInstance('sw-003');
    await inst.dispatch('ENTER', {});
    inst.resolveWait('external');
    expect(inst.getStateStatus('external')).toBe(StateStatus.Active);
  });

  it('can dispatch out after resolveWait', async () => {
    const inst = subWf.createInstance('sw-004');
    await inst.dispatch('ENTER', {});
    inst.resolveWait('external');
    const result = await inst.dispatch('COMPLETE', {});
    expect(result.success).toBe(true);
    expect(inst.isTerminal()).toBe(true);
  });

  it('external snapshot is stored in history on resolve', async () => {
    const externalSnap = subWf.createInstance('child').getSnapshot();
    const inst = subWf.createInstance('sw-005');
    await inst.dispatch('ENTER', {});
    inst.resolveWait('external', externalSnap);
    const resolveEntry = inst
      .getSnapshot()
      .history.find((e) => e.action.startsWith('__resolve_wait'));
    expect(resolveEntry?.payload).toMatchObject({ instanceId: 'child' });
  });
});
