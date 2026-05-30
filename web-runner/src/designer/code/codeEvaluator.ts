import { createWorkflow, createDynamicWorkflow, Guard, StateKind, StateStatus } from 'flowyd';
import { z } from 'zod';
import type { WorkflowDefinition } from 'flowyd';

type RunWorkflow = {
  getDefinition(): WorkflowDefinition;
  createInstance(id: string): {
    dispatch(a: string, p: unknown): Promise<unknown>;
    getSnapshot(): unknown;
    injectGuard(n: string, fn: () => boolean | Promise<boolean>): unknown;
  };
};

export type EvalResult =
  | { ok: true; workflow: RunWorkflow; definition: WorkflowDefinition }
  | { ok: false; error: string };

function stripToJS(tsCode: string): string {
  return tsCode
    .replace(/^\s*import\s+(?:type\s+)?.*?from\s+['"][^'"]+['"].*?;?\s*$/gm, '')
    .replace(/^\s*import\s+['"][^'"]+['"].*?;?\s*$/gm, '')
    .replace(/^\s*export\s+(const|let|var|function|class|async\s+function)\s+/gm, '$1 ')
    .replace(/^\s*export\s+default\s+/gm, 'const __default = ')
    .replace(/^\s*export\s+\{[^}]*\};?\s*$/gm, '')
    .replace(/^\s*["']use strict["'];?\s*$/gm, '');
}

export async function evaluateWorkflowCode(tsCode: string): Promise<EvalResult> {
  try {
    const js = stripToJS(tsCode);

    const fn = new Function(
      'createWorkflow', 'createDynamicWorkflow', 'Guard', 'z', 'StateKind', 'StateStatus',
      `${js}\n` +
      `if (typeof workflow !== 'undefined') return workflow;\n` +
      `return null;`,
    );

    const result: unknown = fn(
      createWorkflow, createDynamicWorkflow, Guard, z, StateKind, StateStatus,
    );

    if (!result || typeof result !== 'object') {
      return {
        ok: false,
        error: 'Define "const workflow = createWorkflow(...).build();" in the editor.',
      };
    }

    const wf = result as RunWorkflow;
    if (typeof wf.getDefinition !== 'function') {
      return { ok: false, error: '"workflow" exists but is not a compiled Workflow object.' };
    }

    return { ok: true, workflow: wf, definition: wf.getDefinition() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
