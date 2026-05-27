import { StateKind } from '../types/index.js';
import type { IForkState } from '../types/index.js';
import { BaseState } from './base.js';

/**
 * A transient state that immediately activates one or more downstream states
 * in parallel when entered, then completes itself in the same engine tick.
 *
 * Use `ForkState` to split a linear SOP into concurrent branches without
 * requiring the caller to dispatch a separate action for each branch.
 *
 * The engine never leaves a `ForkState` in `active` status — it enters and
 * completes it atomically. Downstream branches are activated before the
 * engine returns from `dispatch`.
 *
 * The optional `TValidStates` generic constrains `targets` to a union of
 * known state IDs when the state is constructed in a typed context (e.g. via
 * `WorkflowBuilder.addFork`). When omitted it defaults to `string`, preserving
 * backward-compatibility with direct construction.
 *
 * @template TId          - Literal type of this state's `id`.
 * @template TValidStates - Union of valid target state IDs. Defaults to `string`.
 *
 * @example
 * ```ts
 * // Via the builder (targets autocomplete to declared state names):
 * builder.addFork('parallel-reviews', { targets: ['legal', 'finance'] })
 *
 * // Direct construction (targets: any string[]):
 * new ForkState('parallel-reviews', { targets: ['legal', 'finance'] })
 * ```
 */
export class ForkState<TId extends string = string, TValidStates extends string = string>
  extends BaseState<TId>
  implements IForkState
{
  readonly kind = StateKind.Fork;
  readonly targets: readonly string[];

  /**
   * @param id      - Unique identifier within the workflow. The literal type
   *                  is preserved so `WorkflowBuilder` can track registered IDs.
   * @param options - `targets`: the state IDs to activate simultaneously on
   *                  entry. Must be non-empty; constrained to `TValidStates`
   *                  when that generic is provided.
   * @throws {Error} If `targets` is empty.
   */
  constructor(id: TId, options: { label?: string; targets: [TValidStates, ...TValidStates[]] }) {
    super(id, options.label ?? id);
    if (options.targets.length === 0) {
      throw new Error(`ForkState "${id}" must declare at least one target state`);
    }
    this.targets = [...options.targets];
  }
}
