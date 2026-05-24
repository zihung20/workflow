import type { GuardContext, ReadonlyInstanceState } from '../types/index.js';
import { StateStatus } from '../types/index.js';

/**
 * Creates a minimal `GuardContext` for unit-testing individual guards.
 * Overrides are merged on top of sensible defaults.
 */
export function makeCtx<T = unknown>(
  payload: T = {} as T,
  overrides: Partial<ReadonlyInstanceState> = {},
): GuardContext<T> {
  const base: ReadonlyInstanceState = {
    instanceId: 'test-instance',
    workflowName: 'test-workflow',
    getStateStatus: () => StateStatus.Idle,
    getActiveStates: () => [],
    getWaitingStates: () => [],
    getCompletedStates: () => [],
    isStateCompleted: () => false,
    isStateActive: () => false,
    isStateWaiting: () => false,
    ...overrides,
  };

  return {
    payload,
    instanceState: base,
    resolveGuard: () => undefined,
  };
}
