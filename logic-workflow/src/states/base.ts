import type { IState, StateKind } from '../types/index.js';

/**
 * Abstract base for every built-in state type.
 *
 * Enforces the non-empty ID invariant and wires `id` and `label` into the
 * `IState` contract. Subclasses declare `kind` and any additional properties.
 */
export abstract class BaseState implements IState {
  abstract readonly kind: StateKind;

  constructor(
    readonly id: string,
    readonly label: string,
  ) {
    if (!id.trim()) throw new Error('State id must be a non-empty string');
  }
}
