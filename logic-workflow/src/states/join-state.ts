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
 * @example
 * ```ts
 * .addState(new JoinState('reviews-complete', {
 *   requires: ['legal', 'finance', 'tech'],
 *   mode: 'all',   // wait for all three
 * }))
 * .addTransition({ from: 'reviews-complete', to: 'approved', on: 'FINALIZE' })
 * ```
 */
export class JoinState extends BaseState implements IJoinState {
  readonly kind = StateKind.Join;
  readonly requires: readonly string[];
  readonly mode: JoinMode;

  /**
   * @param id      - Unique identifier within the workflow.
   * @param options - Configuration for the synchronisation barrier.
   *   - `requires`: IDs of states that must complete before this join fires.
   *   - `mode`:     `'all'` (default) | `'any'` | a quorum number.
   * @throws {Error} If `requires` is empty.
   */
  constructor(
    id: string,
    options: { label?: string; requires: string[]; mode?: JoinMode },
  ) {
    super(id, options.label ?? id);
    if (options.requires.length === 0) {
      throw new Error(`JoinState "${id}" must declare at least one required state`);
    }
    this.requires = [...options.requires];
    this.mode = options.mode ?? 'all';
  }
}
