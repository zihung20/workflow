import { StateKind } from '../types/index.js';
import type { ISubWorkflowState } from '../types/index.js';
import { BaseState } from './base.js';

/**
 * A state that delegates to a separately-running external `WorkflowInstance`
 * and blocks the parent workflow until that instance completes.
 *
 * When the engine enters a `SubWorkflowState`, it sets the state's status to
 * `waiting` rather than `active`. The parent workflow is effectively paused
 * at this step. The service layer is responsible for:
 *
 * 1. Creating and driving the external `WorkflowInstance` (via Prisma, a
 *    queue, an external API, etc.).
 * 2. Calling `parentInstance.resolveSubWorkflow(stateId, externalSnapshot?)`
 *    once the external instance has reached a terminal state. This promotes
 *    the `SubWorkflowState` from `waiting` → `active`.
 * 3. Calling `parentInstance.dispatch(action, payload)` with the transition
 *    defined to leave this state (e.g. `'EXTERNAL_COMPLETE'`).
 *
 * This design intentionally keeps the engine free of polling, callbacks, or
 * I/O — all async orchestration lives in the service layer.
 *
 * @example
 * ```ts
 * .addState(new SubWorkflowState('vendor-approval', {
 *   subWorkflowName: 'vendor-kyc',
 * }))
 * .addTransition({ from: 'vendor-approval', to: 'approved', on: 'KYC_PASSED' })
 * .addTransition({ from: 'vendor-approval', to: 'rejected', on: 'KYC_FAILED' })
 * ```
 */
export class SubWorkflowState extends BaseState implements ISubWorkflowState {
  readonly kind = StateKind.SubWorkflow;
  readonly subWorkflowName: string;

  /**
   * @param id      - Unique identifier within the parent workflow.
   * @param options - `subWorkflowName`: the name of the external workflow
   *                  definition this state waits for. Used for documentation
   *                  and visualisation; the engine does not resolve it.
   */
  constructor(id: string, options: { label?: string; subWorkflowName: string }) {
    super(id, options.label ?? id);
    this.subWorkflowName = options.subWorkflowName;
  }
}
