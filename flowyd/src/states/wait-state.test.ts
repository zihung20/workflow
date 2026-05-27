import { describe, it, expect } from 'vitest';
import { WaitState } from './wait-state.js';
import { StateKind } from '../types/index.js';

describe('WaitState', () => {
  it('kind is StateKind.Wait', () => {
    expect(new WaitState('s', { externalName: 'kyc' }).kind).toBe(StateKind.Wait);
  });

  it('stores externalName', () => {
    const s = new WaitState('s', { externalName: 'vendor-kyc' });
    expect(s.externalName).toBe('vendor-kyc');
  });

  it('defaults label to id', () => {
    const s = new WaitState('sub-id', { externalName: 'kyc' });
    expect(s.label).toBe('sub-id');
  });

  it('accepts an explicit label', () => {
    const s = new WaitState('s', { label: 'KYC Check', externalName: 'kyc' });
    expect(s.label).toBe('KYC Check');
  });
});
