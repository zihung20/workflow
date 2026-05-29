/**
 * Performance benchmarks for flowyd engine hot paths.
 *
 * Run with: pnpm test:perf
 *
 * Each test prints timing numbers to stdout. No timing assertions are made —
 * the goal is to surface whether per-dispatch cost grows with history depth,
 * graph width, or branch count, and to give a baseline for future comparison.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { createDynamicWorkflow } from '../../src/core/builder.js';

// ─── Graph builders ───────────────────────────────────────────────────────────

/** N states wired in a single chain: s0 → s1 → … → s(N-1). */
function buildLinearChain(stateCount: number) {
  const ids = Array.from({ length: stateCount }, (_, i) => `s${i}`);
  const builder = createDynamicWorkflow({ name: `linear-${stateCount}` });
  builder.defineAction('NEXT', z.object({}));
  for (const id of ids) {builder.addStep(id);}
  builder.setInitial(ids[0]!).setTerminal([ids[stateCount - 1]!]);
  for (let i = 0; i < stateCount - 1; i++) {
    builder.addTransition({ from: ids[i]!, to: ids[i + 1]!, on: 'NEXT' });
  }
  return builder.build();
}

/**
 * One hub state with `transitionCount` unique outgoing actions, each going to
 * its own terminal state. Exercises the O(T) transition scan on every dispatch.
 *
 * hub --ACTION_0--> target-0 (terminal)
 * hub --ACTION_1--> target-1 (terminal)
 * ...
 */
function buildWideHub(transitionCount: number) {
  const builder = createDynamicWorkflow({ name: `wide-hub-${transitionCount}` });
  builder.addStep('hub');
  const terminals: string[] = [];
  for (let i = 0; i < transitionCount; i++) {
    const target = `target-${i}`;
    builder.defineAction(`ACTION_${i}`, z.object({}));
    builder.addStep(target);
    builder.addTransition({ from: 'hub', to: target, on: `ACTION_${i}` });
    terminals.push(target);
  }
  builder.setInitial('hub').setTerminal(terminals as [string, ...string[]]);
  return builder.build();
}

/**
 * start → fork → [branch-0 … branch-N] → join (all) → end.
 * Exercises the fixed-point join-check loop that scans all states.
 */
function buildParallelBranches(branchCount: number) {
  const branches = Array.from({ length: branchCount }, (_, i) => `branch-${i}`);
  const builder = createDynamicWorkflow({ name: `parallel-${branchCount}` });
  builder.defineAction('START', z.object({}));
  builder.defineAction('COMPLETE_ALL', z.object({}));
  for (let i = 0; i < branchCount; i++) {builder.defineAction(`DONE_${i}`, z.object({}));}
  builder.addStep('start').addFork('fork', { targets: branches as [string, ...string[]] });
  for (const b of branches) {builder.addStep(b);}
  builder.addJoin('join', { requires: branches as [string, ...string[]], mode: 'all' });
  builder.addStep('end');
  builder.setInitial('start').setTerminal(['end']);
  builder.addTransition({ from: 'start', to: 'fork', on: 'START' });
  builder.addTransition({ from: 'join', to: 'end', on: 'COMPLETE_ALL' });
  for (let i = 0; i < branchCount; i++) {
    builder.addTransition({ from: `branch-${i}`, to: 'join', on: `DONE_${i}` });
  }
  return builder.build();
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function mean(arr: number[]) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function windowMean(arr: number[], start: number, size: number) {
  return mean(arr.slice(start, start + size));
}

// ─── Benchmark 1: History depth — does per-dispatch cost grow with H? ─────────

describe('Perf: history depth scaling', () => {
  /**
   * For acyclic workflows, history depth H is bounded by graph depth D, so this
   * test simultaneously probes O(H) history-spreading AND O(S) status-map work.
   * We run chains of 100 / 500 / 2000 steps and look for linearly growing cost.
   */
  for (const n of [100, 500, 2000]) {
    it(`linear chain of ${n} steps: track per-dispatch latency over time`, async () => {
      const wf = buildLinearChain(n);
      const inst = wf.createInstance(`depth-${n}`);
      const samples: number[] = [];

      for (let i = 0; i < n - 1; i++) {
        const t0 = performance.now();
        const r = await inst.dispatch('NEXT', {});
        samples.push(performance.now() - t0);
        expect(r.success).toBe(true);
      }

      const window = Math.min(50, Math.floor(n / 10));
      const early = windowMean(samples, 0, window);
      const mid   = windowMean(samples, Math.floor(n / 2), window);
      const late  = windowMean(samples, n - 1 - window, window);
      const total = samples.reduce((a, b) => a + b, 0);

      console.log(
        `\n  [chain-${n}]` +
        `  total=${total.toFixed(1)}ms` +
        `  early=${early.toFixed(3)}ms  mid=${mid.toFixed(3)}ms  late=${late.toFixed(3)}ms` +
        `  growth(late/early)=${(late / early).toFixed(2)}x`,
      );
    }, 60_000);
  }
});

// ─── Benchmark 2: Transition-count scaling — O(T) per dispatch ────────────────

describe('Perf: transition count scaling (O(T) scan)', () => {
  /**
   * Each run dispatches the *last* registered action (ACTION_{T-1}) which is the
   * worst case for a linear scan — the engine must compare all T transitions before
   * finding the match. We create a fresh instance per dispatch to keep history=0.
   */
  for (const t of [10, 50, 100, 300]) {
    it(`${t} transitions from hub, dispatch last action (worst-case scan, 500 runs)`, async () => {
      const wf = buildWideHub(t);
      const RUNS = 500;
      const samples: number[] = [];

      for (let r = 0; r < RUNS; r++) {
        const inst = wf.createInstance(`hub-${t}-${r}`);
        const t0 = performance.now();
        const res = await inst.dispatch(`ACTION_${t - 1}`, {});
        samples.push(performance.now() - t0);
        expect(res.success).toBe(true);
      }

      const avg = mean(samples);
      const total = samples.reduce((a, b) => a + b, 0);
      console.log(
        `\n  [hub-${t}T]` +
        `  ${RUNS} runs  total=${total.toFixed(1)}ms  avg/dispatch=${avg.toFixed(3)}ms`,
      );
    });
  }
});

// ─── Benchmark 3: Fork/join fixed-point loop — O(S) per join check ───────────

describe('Perf: fork/join fixed-point loop scaling', () => {
  /**
   * The fixed-point loop in computeTransitions iterates ALL states (not just
   * joins) to find ready JoinStates. With B branches there are B+5 states total.
   * Each DONE_i dispatch triggers a full-state scan to check join readiness.
   * Total state-scans for completing all branches = B × (B+5).
   */
  for (const b of [10, 50, 100, 200]) {
    it(`${b} parallel branches: fork → complete all → join`, async () => {
      const wf = buildParallelBranches(b);
      const inst = wf.createInstance(`fork-${b}`);

      const t0 = performance.now();

      const startR = await inst.dispatch('START', {});
      expect(startR.success).toBe(true);

      for (let i = 0; i < b; i++) {
        const r = await inst.dispatch(`DONE_${i}`, {});
        expect(r.success).toBe(true);
      }

      const finalR = await inst.dispatch('COMPLETE_ALL', {});
      expect(finalR.success).toBe(true);
      expect(inst.isTerminal()).toBe(true);

      const elapsed = performance.now() - t0;
      const totalDispatches = b + 2;
      console.log(
        `\n  [fork-${b}B]` +
        `  total=${elapsed.toFixed(1)}ms  dispatches=${totalDispatches}` +
        `  avg/dispatch=${(elapsed / totalDispatches).toFixed(3)}ms`,
      );
    }, 30_000);
  }
});

// ─── Benchmark 4: getSnapshot() deep clone cost at depth ─────────────────────

describe('Perf: getSnapshot() structuredClone cost at different history depths', () => {
  /**
   * getSnapshot() calls structuredClone(this.snapshot). As history grows the
   * clone becomes a deep copy of H HistoryEntry objects each with a full
   * stateStatuses record of size S. Cost is O(H × S).
   */
  for (const n of [50, 200, 500]) {
    it(`getSnapshot() after ${n - 1} dispatches on a ${n}-state chain`, async () => {
      const wf = buildLinearChain(n);
      const inst = wf.createInstance(`snap-${n}`);
      for (let i = 0; i < n - 1; i++) {
        await inst.dispatch('NEXT', {});
      }

      const RUNS = 100;
      const samples: number[] = [];
      for (let r = 0; r < RUNS; r++) {
        const t0 = performance.now();
        inst.getSnapshot();
        samples.push(performance.now() - t0);
      }

      const avg = mean(samples);
      console.log(
        `\n  [snap-${n}]` +
        `  history=${n - 1}  avg getSnapshot()=${avg.toFixed(3)}ms`,
      );
    }, 30_000);
  }
});
