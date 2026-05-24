import { StateKind } from '../types/index.js';
import type { IStepState } from '../types/index.js';
import { BaseState } from './base.js';

/**
 * The fundamental building block of an SOP: a named milestone that becomes
 * `active` when entered and waits for an explicit action to transition out.
 *
 * Every workflow must have at least one `StepState` as its initial state and
 * at least one as a terminal state.
 */
export class StepState<TId extends string = string> extends BaseState<TId> implements IStepState {
  readonly kind = StateKind.Step;

  /**
   * @param id      - Unique identifier within the workflow. The literal type
   *                  is preserved so `WorkflowBuilder` can track registered IDs.
   * @param options - Optional display label (defaults to `id`).
   */
  constructor(id: TId, options: { label?: string } = {}) {
    super(id, options.label ?? id);
  }
}
