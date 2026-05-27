import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { createWorkflow } from '../../src/core/builder.js';
import { Guard } from '../../src/guards/factory.js';

const SubmitSchema = z.object({ submitterId: z.string() });
const ApproveSchema = z.object({ reason: z.string(), approverId: z.string() });
const RejectSchema = z.object({ reason: z.string() });

const purchaseOrder = createWorkflow({
  name: 'purchase-order',
})
  .defineAction('SUBMIT', SubmitSchema)
  .defineAction('APPROVE', ApproveSchema)
  .defineAction('REJECT', RejectSchema)
  .addStep('draft', { label: 'Draft' })
  .addStep('pending-approval', { label: 'Pending Approval' })
  .addStep('approved', { label: 'Approved' })
  .addStep('rejected', { label: 'Rejected' })
  .setInitial('draft')
  .setTerminal(['approved', 'rejected'])
  .addTransition({ from: 'draft', to: 'pending-approval', on: 'SUBMIT' })
  .addTransition({
    from: 'pending-approval',
    to: 'approved',
    on: 'APPROVE',
    guard: Guard.inject('isManager'),
  })
  .addTransition({ from: 'pending-approval', to: 'rejected', on: 'REJECT' })
  .build();

describe('Linear SOP — purchase order', () => {
  it('starts in the initial state', () => {
    const inst = purchaseOrder.createInstance('po-001');
    expect(inst.getCurrentStates()).toEqual(['draft']);
    expect(inst.isTerminal()).toBe(false);
  });

  it('advances on a valid action', async () => {
    const inst = purchaseOrder.createInstance('po-002');
    const result = await inst.dispatch('SUBMIT', { submitterId: 'u1' });
    expect(result.success).toBe(true);
    expect(inst.getCurrentStates()).toEqual(['pending-approval']);
  });

  it('rejects an action that has no valid transition from the current state', async () => {
    const inst = purchaseOrder.createInstance('po-003');
    const result = await inst.dispatch('APPROVE', { reason: 'ok', approverId: 'u2' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe('no-active-source');
    }
  });

  it('blocks when a guard fails', async () => {
    const inst = purchaseOrder.createInstance('po-004');
    inst.injectGuard('isManager', () => false);
    await inst.dispatch('SUBMIT', { submitterId: 'u1' });
    const result = await inst.dispatch('APPROVE', { reason: 'ok', approverId: 'u2' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe('guard-failed');
    }
  });

  it('allows when the guard passes', async () => {
    const inst = purchaseOrder.createInstance('po-005');
    inst.injectGuard('isManager', () => true);
    await inst.dispatch('SUBMIT', { submitterId: 'u1' });
    const result = await inst.dispatch('APPROVE', { reason: 'looks good', approverId: 'mgr' });
    expect(result.success).toBe(true);
    expect(inst.getCurrentStates()).toEqual(['approved']);
    expect(inst.isTerminal()).toBe(true);
  });

  it('rejects further dispatches once terminal', async () => {
    const inst = purchaseOrder.createInstance('po-006');
    await inst.dispatch('SUBMIT', { submitterId: 'u1' });
    await inst.dispatch('REJECT', { reason: 'no budget' });
    const result = await inst.dispatch('SUBMIT', { submitterId: 'u1' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe('terminal-state');
    }
  });

  it('validates the action payload via Zod', async () => {
    const inst = purchaseOrder.createInstance('po-007');
    await expect(
      // @ts-expect-error — intentionally passing wrong shape
      inst.dispatch('SUBMIT', { submitterId: 123 }),
    ).rejects.toThrow();
  });

  it('returns a persisted snapshot that can restore state', async () => {
    const inst = purchaseOrder.createInstance('po-008');
    inst.injectGuard('isManager', () => true);
    await inst.dispatch('SUBMIT', { submitterId: 'u1' });
    const snap = inst.getSnapshot();

    const restored = purchaseOrder.restoreInstance(snap);
    restored.injectGuard('isManager', () => true);
    expect(restored.getCurrentStates()).toEqual(['pending-approval']);
    const r = await restored.dispatch('APPROVE', { reason: 'ok', approverId: 'mgr' });
    expect(r.success).toBe(true);
  });

  it('snapshot version increments on each dispatch', async () => {
    const inst = purchaseOrder.createInstance('po-009');
    expect(inst.getSnapshot().version).toBe(0);
    await inst.dispatch('SUBMIT', { submitterId: 'u1' });
    expect(inst.getSnapshot().version).toBe(1);
  });

  it('canExecute returns false without dispatching', async () => {
    const inst = purchaseOrder.createInstance('po-010');
    inst.injectGuard('isManager', () => false);
    await inst.dispatch('SUBMIT', { submitterId: 'u1' });
    const can = await inst.canExecute('APPROVE', { reason: 'ok', approverId: 'mgr' });
    expect(can).toBe(false);
    // State must not have changed
    expect(inst.getCurrentStates()).toEqual(['pending-approval']);
  });
});
