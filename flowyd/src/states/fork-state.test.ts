import { describe, it, expect } from 'vitest';
import { ForkState } from './fork-state.js';
import { StateKind } from '../types/index.js';

describe('ForkState', () => {
  it('kind is StateKind.Fork', () => {
    expect(new ForkState('f', { targets: ['a', 'b'] }).kind).toBe(StateKind.Fork);
  });

  it('stores targets as a frozen copy', () => {
    const orig: [string, string] = ['a', 'b'];
    const f = new ForkState('f', { targets: orig });
    orig.push('c');
    expect(f.targets).toEqual(['a', 'b']);
  });

  it('throws when targets is empty', () => {
    // @ts-expect-error — intentional: verifying runtime guard for empty array
    expect(() => new ForkState('f', { targets: [] })).toThrow('at least one target');
  });

  it('defaults label to id', () => {
    const f = new ForkState('fork-id', { targets: ['x'] });
    expect(f.label).toBe('fork-id');
  });

  it('accepts an explicit label', () => {
    const f = new ForkState('f', { label: 'Fan Out', targets: ['x'] });
    expect(f.label).toBe('Fan Out');
  });
});
