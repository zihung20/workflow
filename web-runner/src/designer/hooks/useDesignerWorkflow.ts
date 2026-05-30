import { useEffect, useState } from 'react';
import { DEFAULT_WORKFLOW, generateCode } from '../code/codeGenerator';
import type { DesignerWorkflow } from '../types';

const WF_KEY   = 'flowyd-designer-workflow';
const CODE_KEY = 'flowyd-designer-code';

function loadWorkflow(): DesignerWorkflow {
  try {
    const raw = localStorage.getItem(WF_KEY);
    if (raw) return JSON.parse(raw) as DesignerWorkflow;
  } catch { /* ignore corrupt data */ }
  return DEFAULT_WORKFLOW;
}

export interface DesignerWorkflowState {
  workflow: DesignerWorkflow;
  setWorkflow: React.Dispatch<React.SetStateAction<DesignerWorkflow>>;
  /** The code to seed the editor with on first mount. */
  initialCode: string;
  resetToDefault(): void;
}

export function useDesignerWorkflow(): DesignerWorkflowState {
  const [workflow, setWorkflow] = useState<DesignerWorkflow>(loadWorkflow);
  const [initialCode] = useState<string>(() => {
    const saved = loadWorkflow();
    return localStorage.getItem(CODE_KEY) ?? generateCode(saved);
  });

  useEffect(() => {
    localStorage.setItem(WF_KEY, JSON.stringify(workflow));
  }, [workflow]);

  function resetToDefault() {
    localStorage.removeItem(WF_KEY);
    localStorage.removeItem(CODE_KEY);
    localStorage.removeItem('flowyd-positions');
    setWorkflow(DEFAULT_WORKFLOW);
  }

  return { workflow, setWorkflow, initialCode, resetToDefault };
}
