import { describe, it, expect } from 'vitest';
import { JoinState } from './join-state.js';
import { StateKind } from '../types/index.js';

describe('JoinState', () => {
  it('kind is StateKind.Join', () => {
    expect(new JoinState('j', { requires: ['a'] }).kind).toBe(StateKind.Join);
  });

  it('defaults mode to "all"', () => {
    expect(new JoinState('j', { requires: ['a', 'b'] }).mode).toBe('all');
  });

  it('accepts mode "any"', () => {
    expect(new JoinState('j', { requires: ['a', 'b'], mode: 'any' }).mode).toBe('any');
  });

  it('accepts a numeric quorum mode', () => {
    expect(new JoinState('j', { requires: ['a', 'b', 'c'], mode: 2 }).mode).toBe(2);
  });

  it('stores requires as a frozen copy', () => {
    const orig = ['a', 'b'];
    const j = new JoinState('j', { requires: orig });
    orig.push('c');
    expect(j.requires).toEqual(['a', 'b']);
  });

  it('throws when requires is empty', () => {
    expect(() => new JoinState('j', { requires: [] })).toThrow('at least one required');
  });
});
