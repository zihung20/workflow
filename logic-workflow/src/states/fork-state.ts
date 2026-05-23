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
 * @example
 * ```ts
 * .addState(new ForkState('parallel-reviews', { targets: ['legal', 'finance'] }))
 * .addTransition({ from: 'approved', to: 'parallel-reviews', on: 'START_REVIEW' })
 * // After START_REVIEW: 'legal' and 'finance' are both active simultaneously.
 * ```
 */
export class ForkState extends BaseState implements IForkState {
  readonly kind = StateKind.Fork;
  readonly targets: readonly string[];

  /**
   * @param id      - Unique identifier within the workflow.
   * @param options - `targets`: the state IDs to activate simultaneously on
   *                  entry. At least one is required.
   * @throws {Error} If `targets` is empty.
   */
  constructor(id: string, options: { label?: string; targets: string[] }) {
    super(id, options.label ?? id);
    if (options.targets.length === 0) {
      throw new Error(`ForkState "${id}" must declare at least one target state`);
    }
    this.targets = [...options.targets];
  }
}
