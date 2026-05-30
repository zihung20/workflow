# Web Runner — Redesign Plan

## Goal
Transform the existing demo app into a full showcase website with:
1. A landing page with examples gallery
2. Visual drag-and-draw workflow designer
3. Monaco TypeScript editor with flowyd IntelliSense
4. Bidirectional sync between canvas and code

---

## Architecture

```
src/
├── App.tsx                     — React Router (hash-based)
├── monaco-env.ts               — Monaco Web Worker setup (imported once in main.tsx)
├── vite-env.d.ts               — Vite client types for ?raw imports
│
├── pages/
│   ├── HomePage.tsx            — Landing page: hero + features + example gallery
│   ├── ExamplesPage.tsx        — Wraps existing SingleRunner / EwcrRunner
│   └── DesignerPage.tsx        — Full designer: canvas + code + execution panel
│
└── designer/
    ├── types.ts                — DesignerNode, DesignerEdge, DesignerWorkflow, Selection
    │
    ├── canvas/
    │   ├── DesignerCanvas.tsx  — @xyflow/react in interactive edit mode
    │   ├── DesignerToolbar.tsx — "+ Step / Fork / Join / Wait" buttons
    │   └── DesignerStateNode.tsx — Custom ReactFlow node (editable label)
    │
    ├── code/
    │   ├── codeGenerator.ts   — DesignerWorkflow → createWorkflow() TypeScript string
    │   ├── codeEvaluator.ts   — Transpiled JS → WorkflowDefinition (via new Function())
    │   ├── monacoSetup.ts     — Registers flowyd + zod type declarations with Monaco
    │   └── CodeEditor.tsx     — @monaco-editor/react wrapper with imperative handle
    │
    └── panels/
        ├── NodePanel.tsx       — Right panel: configure selected node (id, label, flags)
        └── EdgePanel.tsx       — Right panel: configure selected edge (action, guard body)
```

---

## Bidirectional Sync

```
Canvas drag/connect/configure
        │
        ▼  (immediate)
  codeGenerator.ts → TS string
        │
        ▼  editor.setValue() — suppresses next onChange loop
  Monaco Editor (code panel)
        │
        ▼  (debounced 400 ms, skipped when source === 'canvas')
  Monaco TS worker → getEmitOutput → JS
        │
        ▼
  codeEvaluator.ts → WorkflowDefinition
        │
        ▼
  reconcileDesignerState() → preserve guard bodies, update positions
        │
        ▼
  Canvas re-renders
```

Conflict guard: `editSourceRef: React.MutableRefObject<'canvas'|'code'|null>`.
- Canvas mutates DesignerWorkflow → sets ref = 'canvas' → generates code → calls `editor.setValue()`
- Monaco `onChange` fires → if ref === 'canvas', clear ref and return (skip eval loop)
- User types in Monaco → ref stays null → debounce fires → evaluates → reconciles canvas

---

## Fork / Join Visual Model

- **Fork node**: user draws edges FROM the fork to target states. These edges have `kind: 'fork-target'` (no action name). Code generator reads these and puts them in `addFork({ targets: [...] })`.
- **Join node**: user configures `requires` in the NodePanel (multi-select from available state IDs). Code generator reads `DesignerNode.joinRequires`.

---

## IntelliSense

`monacoSetup.ts` registers hand-written ambient declarations for `flowyd` and a simplified `zod` into Monaco's TypeScript language service via `addExtraLib`. This makes `createWorkflow`, `z.object`, `Guard`, `GuardContext`, etc. available with full autocomplete.

The code template injected into Monaco pre-imports these so the user sees completions immediately.

---

## Monaco TypeScript compiler options (for eval)

```ts
{
  module: ModuleKind.ESNext,   // emit ES imports (we strip them before eval)
  target: ScriptTarget.ES2020,
  strict: true,
}
```

After `getEmitOutput`, the JS has `import` statements. Before `new Function()`:
1. Strip `import ... from '...'` lines
2. Strip `export` keyword from declarations

The user's `const workflow = createWorkflow(...).build()` stays intact.
`new Function` receives `createWorkflow`, `z`, `Guard`, `StateKind` as parameters.
We append `return typeof workflow !== 'undefined' ? workflow.getDefinition() : null;`.

---

## Phases

| Phase | Deliverable | Status |
|-------|-------------|--------|
| 1 | Infrastructure: new deps, vite config, monaco-env, router | ✅ Done |
| 2 | Landing page + routing (HomePage, ExamplesPage) | ✅ Done |
| 3 | Designer canvas (add/drag/connect/delete nodes & edges) | ✅ Done |
| 4 | Code generator (canvas → TS string) | ✅ Done |
| 5 | Monaco editor + flowyd IntelliSense | ✅ Done |
| 6 | Code evaluator + bidirectional sync | ✅ Done |
| 7 | Execution panel (run the designed workflow live) | ✅ Done |
