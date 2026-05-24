import { describe, it, expect } from 'vitest';
import { StepState } from './step-state.js';
import { StateKind } from '../types/index.js';

describe('StepState', () => {
  it('kind is StateKind.Step', () => {
    expect(new StepState('s').kind).toBe(StateKind.Step);
  });

  it('defaults label to id', () => {
    const s = new StepState('my-step');
    expect(s.label).toBe('my-step');
  });

  it('accepts an explicit label', () => {
    const s = new StepState('s', { label: 'My Step' });
    expect(s.label).toBe('My Step');
  });

  it('preserves the id literal type at compile time', () => {
    // If the literal is lost, this assignment would fail type-checking.
    const s = new StepState('concrete-id');
    const _id: 'concrete-id' = s.id;
    expect(_id).toBe('concrete-id');
  });

  it('throws on empty id', () => {
    expect(() => new StepState('')).toThrow('non-empty');
  });

  it('throws on whitespace-only id', () => {
    expect(() => new StepState('   ')).toThrow('non-empty');
  });
});
