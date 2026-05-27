import { StateKind } from '../types/index.js';
import type { IJoinState, JoinMode } from '../types/index.js';
import { BaseState } from './base.js';

/**
 * A synchronisation barrier that monitors a set of prerequisite states and
 * becomes `active` automatically once the completion threshold is met — no
 * explicit `dispatch` is needed to cross the barrier.
 *
 * After the engine applies any transition, it re-evaluates all `JoinState`s
 * whose prerequisites are now fully or partially satisfied. A `JoinState`
 * transitions from `idle` to `active` the moment the `mode` threshold is
 * reached. Once active, it behaves like a `StepState` and waits for an
 * explicit action to advance.
 *
 * The optional `TValidStates` generic constrains `requires` to a union of
 * known state IDs when constructed in a typed context (e.g. via
 * `WorkflowBuilder.addJoin`). When omitted it defaults to `string`, preserving
 * backward-compatibility with direct construction.
 *
 * @template TId          - Literal type of this state's `id`.
 * @template TValidStates - Union of valid prerequisite state IDs. Defaults to `string`.
 *
 * @example
 * ```ts
 * // Via the builder (requires autocomplete to declared state names):
 * builder.addJoin('all-clear', {
 *   requires: ['mechanical', 'electrical', 'safety-systems'],
 *   mode: 'all',
 * })
 *
 * // Direct construction (requires: any string[]):
 * new JoinState('reviews-complete', {
 *   requires: ['legal', 'finance', 'tech'],
 *   mode: 'all',
 * })
 * ```
 */
export class JoinState<TId extends string = string, TValidStates extends string = string>
  extends BaseState<TId>
  implements IJoinState
{
  readonly kind = StateKind.Join;
  readonly requires: readonly string[];
  readonly mode: JoinMode;

  /**
   * @param id      - Unique identifier within the workflow. The literal type
   *                  is preserved so `WorkflowBuilder` can track registered IDs.
   * @param options - Configuration for the synchronisation barrier.
   *   - `requires`: IDs of states that must complete before this join fires.
   *                 Must be non-empty; constrained to `TValidStates` when that
   *                 generic is provided.
   *   - `mode`:     `'all'` (default) | `'any'` | a quorum number.
   * @throws {Error} If `requires` is empty.
   */
  constructor(
    id: TId,
    options: { label?: string; requires: [TValidStates, ...TValidStates[]]; mode?: JoinMode },
  ) {
    super(id, options.label ?? id);
    if (options.requires.length === 0) {
      throw new Error(`JoinState "${id}" must declare at least one required state`);
    }
    this.requires = [...options.requires];
    this.mode = options.mode ?? 'all';
  }
}
