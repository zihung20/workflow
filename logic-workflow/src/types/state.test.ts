import { describe, it, expect } from 'vitest';
import { StateKind, StateStatus } from './state.js';

describe('StateKind enum', () => {
  it('has stable string values', () => {
    expect(StateKind.Step).toBe('step');
    expect(StateKind.Fork).toBe('fork');
    expect(StateKind.Join).toBe('join');
    expect(StateKind.Wait).toBe('wait');
  });

  it('has four members', () => {
    const values = Object.values(StateKind);
    expect(values).toHaveLength(4);
  });
});

describe('StateStatus enum', () => {
  it('has stable string values', () => {
    expect(StateStatus.Idle).toBe('idle');
    expect(StateStatus.Active).toBe('active');
    expect(StateStatus.Waiting).toBe('waiting');
    expect(StateStatus.Completed).toBe('completed');
  });

  it('has four members', () => {
    const values = Object.values(StateStatus);
    expect(values).toHaveLength(4);
  });
});
