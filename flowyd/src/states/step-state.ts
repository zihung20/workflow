import { StateKind } from '../types/index.js';
import type { IStepState } from '../types/index.js';
import { BaseState } from './base.js';

/**
 * The fundamental building block of an SOP: a named milestone that becomes
 * `active` when entered and waits for an explicit action to transition out.
 *
 * Fork-target steps that have no outgoing transitions are automatically
 * completed on entry by the engine (inferred at `build()` time via
 * `WorkflowDefinition.autoCompleteStateIds`) so a downstream `JoinState`
 * can activate via its `requires` list without explicit branch→join transitions.
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
