import { StateKind } from '../types/index.js';
import { BaseState } from './base.js';

/**
 * The fundamental building block of an SOP: a named milestone that becomes
 * `active` when entered and waits for an explicit action to transition out.
 *
 * Every workflow must have at least one `StepState` as its initial state and
 * at least one as a terminal state.
 */
export class StepState extends BaseState {
  readonly kind = StateKind.Step;

  /**
   * @param id      - Unique identifier within the workflow.
   * @param options - Optional display label (defaults to `id`).
   */
  constructor(id: string, options: { label?: string } = {}) {
    super(id, options.label ?? id);
  }
}
