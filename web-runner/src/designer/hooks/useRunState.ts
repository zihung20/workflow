import { useCallback, useState } from 'react';
import { evaluateWorkflowCode } from '../code/codeEvaluator';
import type { WorkflowDefinition, DispatchResult, InstanceSnapshot } from 'flowyd';

type AnyInstance = {
  dispatch(action: string, payload: unknown): Promise<DispatchResult>;
  getSnapshot(): InstanceSnapshot;
  injectGuard(name: string, fn: () => boolean | Promise<boolean>): unknown;
};

export type AnyWorkflow = {
  createInstance(id: string): AnyInstance;
  getDefinition(): WorkflowDefinition;
};

export type RunState =
  | { mode: 'idle' }
  | { mode: 'error'; message: string }
  | { mode: 'running'; definition: WorkflowDefinition; workflow: AnyWorkflow };

export interface RunStateHandles {
  runState: RunState;
  setRunState: React.Dispatch<React.SetStateAction<RunState>>;
  handleRun(getCode: () => string): Promise<void>;
}

export function useRunState(): RunStateHandles {
  const [runState, setRunState] = useState<RunState>({ mode: 'idle' });

  const handleRun = useCallback(async (getCode: () => string) => {
    const code = getCode();
    if (!code) {
      setRunState({ mode: 'error', message: 'Editor not ready — wait a moment and try again.' });
      return;
    }
    const result = await evaluateWorkflowCode(code);
    if (!result.ok) {
      setRunState({ mode: 'error', message: result.error });
      return;
    }
    setRunState({ mode: 'running', definition: result.definition, workflow: result.workflow as AnyWorkflow });
  }, []);

  return { runState, setRunState, handleRun };
}
