import type { Monaco } from "@monaco-editor/react";
import type { IDisposable } from "monaco-editor";
import zodTypes from "../../types/zod.bundle.d.ts?raw";
import flowydTypes from "../../types/flowyd.bundle.d.ts?raw";

let monacoTypesRegistered = false;
let guardContextDisposable: IDisposable | null = null;

/**
 * Converts a full `z.object({ ... })` expression (or bare field body) to an
 * approximate TypeScript type. Used to feed typed `ctx.payload` / `ctx.context`
 * into the guard editor.
 */
function zodExprToTsType(expr: string): string {
  const trimmed = expr.trim();
  if (!trimmed || trimmed === "z.object({})") return "Record<string, unknown>";
  try {
    const innerMatch = /z\.object\(\s*\{([^}]*)\}\s*\)/.exec(trimmed);
    const body = innerMatch ? (innerMatch[1] ?? trimmed) : trimmed;

    const fields: string[] = [];
    const re = /(\w+)\s*:\s*(z\.\w+\([^)]*\)(?:\.\w+\([^)]*\))*)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) {
      const key = m[1];
      const zodToken = m[2];
      if (!key || !zodToken) continue;
      let tsType = "unknown";
      if (/^z\.string\(/.test(zodToken)) tsType = "string";
      else if (/^z\.number\(/.test(zodToken)) tsType = "number";
      else if (/^z\.boolean\(/.test(zodToken)) tsType = "boolean";
      else if (/^z\.date\(/.test(zodToken)) tsType = "Date";
      fields.push(`${key}: ${tsType}`);
    }
    return fields.length > 0
      ? `{ ${fields.join("; ")} }`
      : "Record<string, unknown>";
  } catch {
    return "Record<string, unknown>";
  }
}

/**
 * Re-registers the `ctx` global for guard body editors whenever the selected
 * edge changes. Disposes the previous declaration before adding the new one.
 * @param monacoInstance - The Monaco instance.
 * @param nodeIds - All state node IDs in the current workflow.
 * @param payloadZodBody - Zod object body for the action's payload schema.
 * @param contextZodBody - Zod object body for the workflow context schema.
 */
export function updateGuardContextTypes(
  monacoInstance: Monaco,
  nodeIds: string[],
  payloadZodBody = "",
  contextZodBody = "",
): void {
  const stateIdUnion =
    nodeIds.length > 0
      ? nodeIds.map((id) => JSON.stringify(id)).join(" | ")
      : "string";
  const payloadType = zodExprToTsType(payloadZodBody);
  const contextType = contextZodBody.trim()
    ? zodExprToTsType(contextZodBody)
    : "unknown";

  guardContextDisposable?.dispose();
  guardContextDisposable =
    monacoInstance.languages.typescript.typescriptDefaults.addExtraLib(
      `declare const ctx: import('flowyd').GuardContext<${payloadType}, ${contextType}, ${stateIdUnion}>;`,
      "file:///guard-context.d.ts",
    );
}

/**
 * Registers flowyd and zod type declarations with Monaco's TypeScript service.
 * Uses pre-bundled single-file declarations (no module resolution required).
 * Safe to call multiple times — runs only once per page load.
 * @param monacoInstance - The Monaco instance returned by `useMonaco()`.
 */
export function setupMonacoTypes(monacoInstance: Monaco): void {
  if (monacoTypesRegistered) return;
  monacoTypesRegistered = true;

  const ts = monacoInstance.languages.typescript;

  ts.typescriptDefaults.setCompilerOptions({
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    strict: true,
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
    lib: ["es2020", "dom", "dom.iterable"],
  });

  ts.typescriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
    // Guard bodies are function bodies — top-level `return` is intentional.
    diagnosticCodesToIgnore: [1108],
  });

  // Single-file bundles: each is a `declare module 'pkg' { ... }` block with
  // all declarations inlined. No inter-file imports to resolve.
  ts.typescriptDefaults.addExtraLib(flowydTypes, "file:///flowyd.d.ts");
  ts.typescriptDefaults.addExtraLib(zodTypes, "file:///zod.d.ts");

  // Re-add the `z` named export that our bundle stripped (the real zod index.d.ts does
  // `import * as z from './v3/external'; export { z }`). This file is a module (has an
  // import) so `declare module 'zod' { ... }` inside it is a valid module augmentation.
  ts.typescriptDefaults.addExtraLib(
    `import type * as _zod from 'zod';
declare module 'zod' { export const z: typeof _zod; }`,
    "file:///zod-z-export.d.ts",
  );

  // Expose `z` as a global so schema/guard editors can write `z.object({...})` without an import.
  ts.typescriptDefaults.addExtraLib(
    `declare const z: typeof import('zod');`,
    "file:///zod-global.d.ts",
  );
}
