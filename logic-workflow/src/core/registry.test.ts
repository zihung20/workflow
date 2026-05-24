import { describe, it, expect } from 'vitest';
import { StateRegistry, GuardRegistry } from './registry.js';
import { StepState } from '../states/step-state.js';

describe('StateRegistry', () => {
  it('registers and retrieves a state by id', () => {
    const reg = new StateRegistry();
    const s = new StepState('alpha');
    reg.register(s);
    expect(reg.get('alpha')).toBe(s);
  });

  it('throws on duplicate state id', () => {
    const reg = new StateRegistry();
    reg.register(new StepState('dup'));
    expect(() => reg.register(new StepState('dup'))).toThrow('"dup"');
  });

  it('throws when get is called with an unregistered id', () => {
    const reg = new StateRegistry();
    expect(() => reg.get('ghost')).toThrow('"ghost"');
  });

  it('has() returns true for registered ids and false otherwise', () => {
    const reg = new StateRegistry();
    reg.register(new StepState('x'));
    expect(reg.has('x')).toBe(true);
    expect(reg.has('y')).toBe(false);
  });

  it('snapshot() returns an independent copy of the map', () => {
    const reg = new StateRegistry();
    reg.register(new StepState('a'));
    const snap = reg.snapshot();
    // Adding another state after snapshotting must not affect the snapshot
    reg.register(new StepState('b'));
    expect(snap.has('b')).toBe(false);
    expect(snap.size).toBe(1);
  });
});

describe('GuardRegistry', () => {
  it('registers and resolves a guard by name', () => {
    const reg = new GuardRegistry();
    const fn = async () => true;
    reg.register('myGuard', fn);
    expect(reg.resolve('myGuard')).toBe(fn);
  });

  it('returns undefined for an unregistered name', () => {
    const reg = new GuardRegistry();
    expect(reg.resolve('missing')).toBeUndefined();
  });

  it('overwrites a previously registered guard on re-registration', () => {
    const reg = new GuardRegistry();
    const first = async () => true;
    const second = async () => false;
    reg.register('g', first);
    reg.register('g', second);
    expect(reg.resolve('g')).toBe(second);
  });
});
