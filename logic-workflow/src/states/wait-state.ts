import { StateKind } from '../types/index.js';
import type { IWaitState } from '../types/index.js';
import { BaseState } from './base.js';

/**
 * A state that pauses the parent workflow until an external signal arrives.
 *
 * When the engine enters a `WaitState`, it sets the state's status to
 * `waiting` rather than `active`. The parent workflow is effectively paused
 * at this step. The service layer is responsible for:
 *
 * 1. Creating and driving the external process (via Prisma, a queue, an
 *    external API, etc.).
 * 2. Calling `parentInstance.resolveWait(stateId, externalSnapshot?)`
 *    once the external process has completed. This promotes the `WaitState`
 *    from `waiting` → `active`.
 * 3. Calling `parentInstance.dispatch(action, payload)` with the transition
 *    defined to leave this state (e.g. `'EXTERNAL_COMPLETE'`).
 *
 * This design intentionally keeps the engine free of polling, callbacks, or
 * I/O — all async orchestration lives in the service layer.
 *
 * @example
 * ```ts
 * createWorkflow({ name: 'vendor', states: ['draft', 'vendor-approval', 'approved', 'rejected'] })
 *   .addWait('vendor-approval', { externalName: 'vendor-kyc' })
 *   .addTransition({ from: 'vendor-approval', to: 'approved', on: 'KYC_PASSED' })
 *   .addTransition({ from: 'vendor-approval', to: 'rejected', on: 'KYC_FAILED' })
 * ```
 */
export class WaitState<TId extends string = string> extends BaseState<TId> implements IWaitState {
  readonly kind = StateKind.Wait;
  readonly externalName: string;

  /**
   * @param id      - Unique identifier within the parent workflow. The literal
   *                  type is preserved so `WorkflowBuilder` can track registered IDs.
   * @param options - `externalName`: the name of the external process this state
   *                  waits for. Used for documentation and visualisation; the
   *                  engine does not resolve it.
   */
  constructor(id: TId, options: { label?: string; externalName: string }) {
    super(id, options.label ?? id);
    this.externalName = options.externalName;
  }
}
