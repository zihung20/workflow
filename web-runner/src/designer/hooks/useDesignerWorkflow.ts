import { useEffect, useState } from 'react';
import { DEFAULT_WORKFLOW } from '../code/codeGenerator';
import type { DesignerWorkflow } from '../types';

const WF_KEY = 'flowyd-designer-workflow';

function loadWorkflow(): DesignerWorkflow {
  try {
    const raw = localStorage.getItem(WF_KEY);
    if (raw) {
      const data = JSON.parse(raw) as Partial<DesignerWorkflow>;
      return {
        ...DEFAULT_WORKFLOW,
        ...data,
        // Provide defaults for fields added after initial release
        actionSchemas: data.actionSchemas ?? {},
        contextSchemaBody: data.contextSchemaBody ?? '',
      };
    }
  } catch { /* ignore corrupt data */ }
  return DEFAULT_WORKFLOW;
}

export interface DesignerWorkflowState {
  workflow: DesignerWorkflow;
  setWorkflow: React.Dispatch<React.SetStateAction<DesignerWorkflow>>;
  resetToDefault(): void;
}

export function useDesignerWorkflow(): DesignerWorkflowState {
  const [workflow, setWorkflow] = useState<DesignerWorkflow>(loadWorkflow);

  useEffect(() => {
    localStorage.setItem(WF_KEY, JSON.stringify(workflow));
  }, [workflow]);

  function resetToDefault() {
    localStorage.removeItem(WF_KEY);
    localStorage.removeItem('flowyd-positions');
    setWorkflow(DEFAULT_WORKFLOW);
  }

  return { workflow, setWorkflow, resetToDefault };
}
