import { useCallback, useEffect, useRef } from 'react';
import { generateCode } from '../code/codeGenerator';
import { evaluateWorkflowCode } from '../code/codeEvaluator';
import { reconcile } from '../utils/reconcile';
import type { CodeEditorHandle } from '../code/CodeEditor';
import type { DesignerWorkflow } from '../types';

const CODE_KEY = 'flowyd-designer-code';

interface Options {
  editorRef: React.RefObject<CodeEditorHandle | null>;
  /** A ref that always holds the current workflow so closures see fresh data. */
  workflowRef: React.RefObject<DesignerWorkflow>;
  /** Called when code→canvas reconciliation produces a new workflow. */
  setWorkflow: React.Dispatch<React.SetStateAction<DesignerWorkflow>>;
  onEvalError(err: string | null): void;
}

export interface CodeSyncHandles {
  /** Push the current canvas state into the code editor (canvas → code). */
  pushCode(wf: DesignerWorkflow): void;
  /** Feed a raw code string from the editor into the canvas (code → canvas). */
  handleCodeChange(code: string): void;
}

export function useCodeSync({ editorRef, workflowRef, setWorkflow, onEvalError }: Options): CodeSyncHandles {
  const editSrc      = useRef<'canvas' | 'code' | null>(null);
  const evalTimer    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveTimer    = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (evalTimer.current) clearTimeout(evalTimer.current);
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  const pushCode = useCallback((wf: DesignerWorkflow) => {
    editSrc.current = 'canvas';
    editorRef.current?.setValue(generateCode(wf));
  }, [editorRef]);

  const handleCodeChange = useCallback((code: string) => {
    if (editSrc.current === 'canvas') {
      editSrc.current = null;
      return;
    }
    editSrc.current = 'code';
    onEvalError(null);

    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      localStorage.setItem(CODE_KEY, code);
    }, 800);

    if (evalTimer.current) clearTimeout(evalTimer.current);
    evalTimer.current = setTimeout(() => {
      void (async () => {
        const result = await evaluateWorkflowCode(code);
        if (!result.ok) {
          onEvalError(result.error);
          editSrc.current = null;
          return;
        }
        // Update workflow state directly (not via handleWorkflowChange) to avoid re-pushing code
        editSrc.current = 'canvas';
        setWorkflow(reconcile(workflowRef.current, result.definition));
        editSrc.current = null;
      })();
    }, 600);
  }, [editorRef, workflowRef, setWorkflow, onEvalError]);

  return { pushCode, handleCodeChange };
}
