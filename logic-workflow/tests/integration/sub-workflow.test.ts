import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { WorkflowBuilder } from '../../src/core/builder.js';
import { StepState } from '../../src/states/step-state.js';
import { SubWorkflowState } from '../../src/states/sub-workflow-state.js';
import { StateStatus } from '../../src/types/index.js';

const Empty = z.object({});

/**
 * Vendor onboarding SOP:
 *   draft ──SUBMIT──▶ kyc-check(SubWorkflow) ──KYC_PASSED──▶ approved
 *                                              └──KYC_FAILED──▶ rejected
 *
 * The kyc-check state blocks until the service layer calls resolveSubWorkflow.
 */
const vendorOnboarding = new WorkflowBuilder('vendor-onboarding')
  .defineAction('SUBMIT', Empty)
  .defineAction('KYC_PASSED', Empty)
  .defineAction('KYC_FAILED', Empty)
  .addState(new StepState('draft'))
  .addState(new SubWorkflowState('kyc-check', { subWorkflowName: 'vendor-kyc' }))
  .addState(new StepState('approved'))
  .addState(new StepState('rejected'))
  .setInitial('draft')
  .setTerminal(['approved', 'rejected'])
  .addTransition({ from: 'draft', to: 'kyc-check', on: 'SUBMIT' })
  .addTransition({ from: 'kyc-check', to: 'approved', on: 'KYC_PASSED' })
  .addTransition({ from: 'kyc-check', to: 'rejected', on: 'KYC_FAILED' })
  .build();

describe('SubWorkflow SOP — vendor onboarding', () => {
  it('enters waiting status when the sub-workflow state is reached', async () => {
    const inst = vendorOnboarding.createInstance('vo-001');
    await inst.dispatch('SUBMIT', {});
    expect(inst.getStateStatus('kyc-check')).toBe('waiting');
  });

  it('includes waiting states in getCurrentStates()', async () => {
    const inst = vendorOnboarding.createInstance('vo-002');
    await inst.dispatch('SUBMIT', {});
    expect(inst.getCurrentStates()).toContain('kyc-check');
  });

  it('blocks dispatch while sub-workflow is still waiting', async () => {
    const inst = vendorOnboarding.createInstance('vo-003');
    await inst.dispatch('SUBMIT', {});
    // kyc-check is waiting, not active — no active source for KYC_PASSED
    const result = await inst.dispatch('KYC_PASSED', {});
    expect(result.success).toBe(false);
    if (!result.success) expect(result.reason).toBe('no-active-source');
  });

  it('promotes the state to active after resolveSubWorkflow is called', async () => {
    const inst = vendorOnboarding.createInstance('vo-004');
    await inst.dispatch('SUBMIT', {});
    inst.resolveSubWorkflow('kyc-check');
    expect(inst.getStateStatus('kyc-check')).toBe('active');
  });

  it('allows dispatch after resolveSubWorkflow — happy path', async () => {
    const inst = vendorOnboarding.createInstance('vo-005');
    await inst.dispatch('SUBMIT', {});
    inst.resolveSubWorkflow('kyc-check');
    const result = await inst.dispatch('KYC_PASSED', {});
    expect(result.success).toBe(true);
    expect(inst.getCurrentStates()).toEqual(['approved']);
    expect(inst.isTerminal()).toBe(true);
  });

  it('allows dispatch after resolveSubWorkflow — failure path', async () => {
    const inst = vendorOnboarding.createInstance('vo-006');
    await inst.dispatch('SUBMIT', {});
    inst.resolveSubWorkflow('kyc-check');
    const result = await inst.dispatch('KYC_FAILED', {});
    expect(result.success).toBe(true);
    expect(inst.getCurrentStates()).toEqual(['rejected']);
    expect(inst.isTerminal()).toBe(true);
  });

  it('increments version on resolveSubWorkflow', async () => {
    const inst = vendorOnboarding.createInstance('vo-007');
    await inst.dispatch('SUBMIT', {});
    const vBefore = inst.getSnapshot().version;
    inst.resolveSubWorkflow('kyc-check');
    expect(inst.getSnapshot().version).toBe(vBefore + 1);
  });

  it('records resolveSubWorkflow in history', async () => {
    const inst = vendorOnboarding.createInstance('vo-008');
    await inst.dispatch('SUBMIT', {});
    inst.resolveSubWorkflow('kyc-check');
    const history = inst.getSnapshot().history;
    const resolveEntry = history.find((e) => e.action.startsWith('__resolve_sub_workflow'));
    expect(resolveEntry).toBeDefined();
    expect(resolveEntry?.action).toBe('__resolve_sub_workflow:kyc-check');
  });

  it('stores an optional external snapshot in history', async () => {
    const inst = vendorOnboarding.createInstance('vo-009');
    await inst.dispatch('SUBMIT', {});
    const fakeExternal = {
      instanceId: 'kyc-run-42',
      workflowName: 'vendor-kyc',
      version: 3,
      stateStatuses: { done: StateStatus.Completed },
      isTerminal: true,
      history: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    inst.resolveSubWorkflow('kyc-check', fakeExternal);
    const history = inst.getSnapshot().history;
    const entry = history.find((e) => e.action.startsWith('__resolve_sub_workflow'));
    expect(entry?.payload).toMatchObject({ instanceId: 'kyc-run-42' });
  });

  it('throws when resolveSubWorkflow is called on a non-SubWorkflow state', async () => {
    const inst = vendorOnboarding.createInstance('vo-010');
    expect(() => inst.resolveSubWorkflow('draft')).toThrow('SubWorkflowState');
  });

  it('throws when resolveSubWorkflow is called while state is not waiting', async () => {
    const inst = vendorOnboarding.createInstance('vo-011');
    // Never submitted — kyc-check is still idle
    expect(() => inst.resolveSubWorkflow('kyc-check')).toThrow('not waiting');
  });

  it('snapshot can be restored and continues after resolveSubWorkflow', async () => {
    const inst = vendorOnboarding.createInstance('vo-012');
    await inst.dispatch('SUBMIT', {});
    inst.resolveSubWorkflow('kyc-check');
    const snap = inst.getSnapshot();

    const restored = vendorOnboarding.restoreInstance(snap);
    const result = await restored.dispatch('KYC_PASSED', {});
    expect(result.success).toBe(true);
    expect(restored.isTerminal()).toBe(true);
  });
});
