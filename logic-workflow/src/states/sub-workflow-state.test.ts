import { describe, it, expect } from 'vitest';
import { SubWorkflowState } from './sub-workflow-state.js';
import { StateKind } from '../types/index.js';

describe('SubWorkflowState', () => {
  it('kind is StateKind.SubWorkflow', () => {
    expect(new SubWorkflowState('s', { subWorkflowName: 'kyc' }).kind).toBe(StateKind.SubWorkflow);
  });

  it('stores subWorkflowName', () => {
    const s = new SubWorkflowState('s', { subWorkflowName: 'vendor-kyc' });
    expect(s.subWorkflowName).toBe('vendor-kyc');
  });

  it('defaults label to id', () => {
    const s = new SubWorkflowState('sub-id', { subWorkflowName: 'kyc' });
    expect(s.label).toBe('sub-id');
  });

  it('accepts an explicit label', () => {
    const s = new SubWorkflowState('s', { label: 'KYC Check', subWorkflowName: 'kyc' });
    expect(s.label).toBe('KYC Check');
  });
});
