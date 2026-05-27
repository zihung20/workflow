import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { createWorkflow } from '../../src/core/builder.js';

const Empty = z.object({});

/**
 * Procurement SOP: start → fork(legal, finance) → join(all) → approved
 *
 *   start ──START──▶ fork ──▶ legal ──LEGAL_DONE──▶ ┐
 *                         └──▶ finance ──FINANCE_DONE──▶ join(all) ──FINALIZE──▶ approved
 */
const procurement = createWorkflow({
  name: 'procurement',
  states: ['start', 'fork', 'legal', 'finance', 'join', 'approved'],
})
  .defineAction('START', Empty)
  .defineAction('LEGAL_DONE', Empty)
  .defineAction('FINANCE_DONE', Empty)
  .defineAction('FINALIZE', Empty)
  .addStep('start')
  .addFork('fork', { targets: ['legal', 'finance'] })
  .addStep('legal')
  .addStep('finance')
  .addJoin('join', { requires: ['legal', 'finance'], mode: 'all' })
  .addStep('approved')
  .setInitial('start')
  .setTerminal(['approved'])
  .addTransition({ from: 'start', to: 'fork', on: 'START' })
  .addTransition({ from: 'legal', to: 'join', on: 'LEGAL_DONE' })
  .addTransition({ from: 'finance', to: 'join', on: 'FINANCE_DONE' })
  .addTransition({ from: 'join', to: 'approved', on: 'FINALIZE' })
  .build();

describe('Parallel-join SOP — procurement', () => {
  it('forks into two active branches simultaneously', async () => {
    const inst = procurement.createInstance('prc-001');
    await inst.dispatch('START', {});
    const states = inst.getCurrentStates().sort();
    expect(states).toEqual(['finance', 'legal']);
  });

  it('join does not activate until both branches complete', async () => {
    const inst = procurement.createInstance('prc-002');
    await inst.dispatch('START', {});
    await inst.dispatch('LEGAL_DONE', {});
    // Only legal is done — join must still be idle
    const states = inst.getCurrentStates().sort();
    expect(states).toContain('finance');
    expect(states).not.toContain('join');
  });

  it('activates join once both branches complete', async () => {
    const inst = procurement.createInstance('prc-003');
    await inst.dispatch('START', {});
    await inst.dispatch('LEGAL_DONE', {});
    await inst.dispatch('FINANCE_DONE', {});
    expect(inst.getCurrentStates()).toEqual(['join']);
  });

  it('completes full happy-path to terminal', async () => {
    const inst = procurement.createInstance('prc-004');
    await inst.dispatch('START', {});
    await inst.dispatch('LEGAL_DONE', {});
    await inst.dispatch('FINANCE_DONE', {});
    const r = await inst.dispatch('FINALIZE', {});
    expect(r.success).toBe(true);
    expect(inst.getCurrentStates()).toEqual(['approved']);
    expect(inst.isTerminal()).toBe(true);
  });

  it('rejects dispatching the same branch action twice', async () => {
    const inst = procurement.createInstance('prc-005');
    await inst.dispatch('START', {});
    await inst.dispatch('LEGAL_DONE', {});
    // legal is now completed — no active source for a second LEGAL_DONE
    const result = await inst.dispatch('LEGAL_DONE', {});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe('no-active-source');
    }
  });

  it('snapshot captures both branch statuses correctly', async () => {
    const inst = procurement.createInstance('prc-006');
    await inst.dispatch('START', {});
    await inst.dispatch('LEGAL_DONE', {});
    const snap = inst.getSnapshot();

    expect(snap.stateStatuses['legal']).toBe('completed');
    expect(snap.stateStatuses['finance']).toBe('active');
    expect(snap.stateStatuses['join']).toBe('idle');
  });
});

/**
 * Any-join variant: activates once at least one of the required branches
 * completes. Uses mode: 'any'.
 *
 *   start ──GO──▶ fork ──▶ branch-a ──DONE_A──▶ ┐
 *                       └──▶ branch-b ──DONE_B──▶ join(any) ──PROCEED──▶ end
 */
const anyJoin = createWorkflow({
  name: 'any-join',
  states: ['start', 'fork', 'branch-a', 'branch-b', 'join', 'end'],
})
  .defineAction('GO', Empty)
  .defineAction('DONE_A', Empty)
  .defineAction('DONE_B', Empty)
  .defineAction('PROCEED', Empty)
  .addStep('start')
  .addFork('fork', { targets: ['branch-a', 'branch-b'] })
  .addStep('branch-a')
  .addStep('branch-b')
  .addJoin('join', { requires: ['branch-a', 'branch-b'], mode: 'any' })
  .addStep('end')
  .setInitial('start')
  .setTerminal(['end'])
  .addTransition({ from: 'start', to: 'fork', on: 'GO' })
  .addTransition({ from: 'branch-a', to: 'join', on: 'DONE_A' })
  .addTransition({ from: 'branch-b', to: 'join', on: 'DONE_B' })
  .addTransition({ from: 'join', to: 'end', on: 'PROCEED' })
  .build();

describe('Any-join — fires on first branch completion', () => {
  it('activates join after only branch-a completes', async () => {
    const inst = anyJoin.createInstance('aj-001');
    await inst.dispatch('GO', {});
    await inst.dispatch('DONE_A', {});
    // join should be active now even though branch-b is still active
    expect(inst.getStateStatus('join')).toBe('active');
  });

  it('activates join after only branch-b completes', async () => {
    const inst = anyJoin.createInstance('aj-002');
    await inst.dispatch('GO', {});
    await inst.dispatch('DONE_B', {});
    expect(inst.getStateStatus('join')).toBe('active');
  });
});
