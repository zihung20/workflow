import type { IState, StateKind } from '../types/index.js';

/**
 * Abstract base for every built-in state type.
 *
 * Enforces the non-empty ID invariant and wires `id` and `label` into the
 * `IState` contract. Subclasses declare `kind` and any additional properties.
 *
 * The `TId` parameter preserves the string literal type of the constructor
 * argument so that the `WorkflowBuilder` factory methods (`addStep`, `addFork`,
 * `addJoin`, `addWait`) can track registered IDs at compile time.
 *
 * @template TId - The literal string type of this state's `id`. Defaults to
 *                 `string` for cases where the ID is not known at compile time.
 */
export abstract class BaseState<TId extends string = string> implements IState {
  abstract readonly kind: StateKind;

  constructor(
    readonly id: TId,
    readonly label: string,
  ) {
    if (!id.trim()) {
      throw new Error('State id must be a non-empty string');
    }
  }
}
