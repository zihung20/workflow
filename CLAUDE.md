# CLAUDE.md — Project Law

This file is the authoritative reference for every agent and developer working in this codebase. Read it before touching any file. The rules here override instinct, habit, and convention.

---

## 1. System Overview

`logic-workflow` is a TypeScript library for building typed, auditable workflow state machines. It exposes a fluent `WorkflowBuilder` API that enforces state-ID correctness at compile time, a pure stateless `WorkflowEngine` that executes transitions, and pluggable guard functions for async business-rule evaluation. Snapshots are plain JSON — the library has no opinion on storage.

**Companion apps (not in this directory):**

- `../web-runner/` — React SPA (Vite + Tailwind + @xyflow/react) that visualises and drives workflows in the browser. Always run `pnpm build` in this directory before starting the web runner.
- `docs/` — VitePress documentation site (Diátaxis structure). Run with `pnpm docs:dev`.

---

## 2. Core File Map

```
src/
├── types/
│   ├── state.ts          — IStepState, IForkState, IJoinState, IWaitState, AnyState discriminated union
│   ├── workflow.ts       — WorkflowDefinition, InstanceSnapshot, TransitionDefinition
│   ├── guards.ts         — IGuard interface, GuardContext
│   └── index.ts          — barrel re-export

├── states/
│   ├── base.ts           — BaseState<TId> — shared id/status/label logic
│   ├── step-state.ts     — StepState implements IStepState
│   ├── fork-state.ts     — ForkState<TId, TValidStates> — splits into parallel branches
│   ├── join-state.ts     — JoinState<TId, TValidStates> — synchronises branches (all/any/quorum)
│   └── wait-state.ts — WaitState — pauses until external process resolves

├── guards/
│   ├── factory.ts        — Guard namespace: inject, stateCompleted, stateActive, and, or, not, fn, always, never
│   └── *.test.ts         — unit tests co-located with source

├── core/
│   ├── builder.ts        — WorkflowBuilder<TActions, TStates> — Config-First fluent builder
│   ├── engine.ts         — WorkflowEngine — pure static dispatch; fixed-point join loop
│   ├── instance.ts       — WorkflowInstance — stateful wrapper; holds snapshot; exposes dispatch/getSnapshot/restoreInstance
│   ├── registry.ts       — StateRegistry — typed Map<string, AnyState>
│   └── *.test.ts         — unit tests co-located with source

├── visualization/
│   ├── mermaid.ts        — MermaidExporter
│   └── json-graph.ts     — JsonGraphExporter, JsonGraph, JsonGraphNode, JsonGraphEdge

└── index.ts              — public barrel: WorkflowBuilder, Guard, state classes, types, exporters
```

**Key entry points in `package.json`:**

- `"."` → `dist/index.js` — core library
- `"./visualization"` → `dist/visualization/index.js` — visualization (tree-shakeable)

---

## 3. Architectural Decisions & Guardrails

### Package manager

**`pnpm` exclusively. No exceptions.**

```sh
pnpm install   pnpm add <pkg>   pnpm run build   pnpm test
# Never: npm install / yarn add
```

If a `package-lock.json` or `yarn.lock` appears, delete it and investigate.

---

### TypeScript strict mode

The following `compilerOptions` must remain enabled at all times:

```json
"strict": true,
"exactOptionalPropertyTypes": true,
"noUncheckedIndexedAccess": true,
"noImplicitOverride": true
```

- No `any`. Use `unknown` and narrow explicitly.
- No non-null assertions (`!`) without a comment proving the value is non-null at that site.
- No `as` casts except at layer boundaries (after a `kind` discriminant check). Every cast needs a comment.

---

### Zod as single source of truth

Every payload type is derived from a Zod schema via `z.infer<typeof MySchema>`. Never write a parallel `type` or `interface`.

```ts
// Correct
const UserSchema = z.object({ id: z.string(), score: z.number() });
type User = z.infer<typeof UserSchema>;

// Never — duplicated source of truth
interface User { id: string; score: number; }
const UserSchema = z.object({ id: z.string(), score: z.number() });
```

---

### Layer architecture — one-way dependency rule

```
visualization/
    ↓
core/
    ↓
states/
    ↓
types/
```

- `core/` must not import from `visualization/`.
- `states/` must not import from `core/`.
- `types/` must not import from any other layer.
- Cross-layer communication goes through `types/` interfaces only.

Treat a violation as a build error even when the compiler does not catch it.

---

### Config-First WorkflowBuilder

All state IDs are declared upfront in the constructor. This establishes the `TStates` union at instantiation, so `addStep`, `addFork`, `addJoin`, `addWait`, `setInitial`, `setTerminal`, and `addTransition` are all constrained to that fixed set — typos fail at compile time.

```ts
const wf = createWorkflow({
  name: 'my-workflow',
  states: ['draft', 'review', 'approved', 'rejected'],  // no `as const` needed
})
  .defineAction('SUBMIT', z.object({ submitterId: z.string() }))
  .addStep('draft')
  .addStep('review')
  .addStep('approved')
  .addStep('rejected')
  .setInitial('draft')
  .setTerminal(['approved', 'rejected'])
  .addTransition({ from: 'draft', to: 'review', on: 'SUBMIT' })
  .build();
```

**Rules:**
- Use `createWorkflow()` — the `const` type parameter infers literal types automatically.
- Never use `new WorkflowBuilder('name')` (old positional signature — removed) or `new WorkflowBuilder({...})` directly.
- Every state must be registered via `addStep`, `addFork`, `addJoin`, or `addWait`. There is no `addState` escape hatch.
- `addFork` targets and `addJoin` requires autocomplete to the `TStates` union. A reference to an unregistered ID is both a compile-time error and a `build()` runtime error.
- `defineAction` returns a new generic specialization (`WorkflowBuilder<TActions & Record<K, T>, TStates>`) because `TActions` must accumulate per call. The runtime object is unchanged; only the TypeScript type widens. All other methods return `this`.

---

### Discriminated union — no unsafe casts in the engine

`AnyState = IStepState | IForkState | IJoinState | IWaitState` (in `src/types/state.ts`).

The `kind` property is a literal on each interface. Narrow with `state.kind === StateKind.Fork` — do not cast with `state as IForkState`. The six remaining `as` casts in the codebase are at storage-boundary sites and all have justifying comments.

---

### Pure stateless engine

`WorkflowEngine.dispatch()` is a static method. It takes a snapshot and an action, returns a new snapshot (or `TransitionBlocked`), and never mutates anything. No I/O, no `setTimeout`, no side effects. Guards that need I/O are injected as `() => Promise<boolean>` callbacks via `instance.injectGuard()`.

---

### No silent failures — everything throws

Functions that can fail must throw a typed error with a precise message. Do not return `null`, `undefined`, or `false` to signal failure.

The only sanctioned exception: `dispatch` returns `TransitionBlocked` for domain failures (`guard-failed`, `terminal-state`, `no-active-source`). These are valid, expected outcomes that the caller's business logic must handle. Payload validation failure still throws `ZodError`.

---

### No swallowed exceptions

`try/catch` must either re-throw or wrap-and-re-throw. Logging and continuing is not acceptable.

```ts
// Correct
try { result = await doWork(); }
catch (err) { throw new WorkflowExecutionError('failed', { cause: err }); }

// Never
try { result = await doWork(); }
catch { result = defaultValue; }
```

---

### Purely functional persistence

`getSnapshot()` returns a plain JSON object. `restoreInstance(snapshot)` reconstructs exact state from it. The library never touches storage. Guard functions are runtime behaviour and are not persisted — re-inject them after every `restoreInstance`.

---

### TSDoc on every exported symbol

Every exported class, interface, type alias, and function needs a TSDoc block with:
- One-sentence description (imperative mood)
- `@param` for every parameter
- `@returns` describing shape and meaning
- `@throws` for every error condition callers must handle

Private/internal methods only need TSDoc when their purpose is genuinely non-obvious.

**Inside function bodies:** Only write a comment when the *reason* would surprise an informed reader. Explain why, not what. Obvious syntax gets no comment.

---

### Visualization is a separate entry point

`MermaidExporter` and `JsonGraphExporter` live in `src/visualization/` and are exported from `"logic-workflow/visualization"`. Bundlers can tree-shake this from applications that don't use it. `core/` has zero knowledge that visualization exists.

---

### Vitest workspace — three named projects

| Project | Glob | Purpose |
|---|---|---|
| `unit` | `src/**/*.test.ts` | Co-located unit tests |
| `integration` | `tests/integration/**/*.test.ts` | Multi-component flows |
| `e2e` | `tests/e2e/**/*.test.ts` | Full workflow invariants |

`tests/helpers.ts` — shared `makeCtx` fixture used by unit tests in `src/guards/`.

```sh
pnpm test              # all three projects
pnpm test:unit         # unit only
pnpm test:integration  # integration only
pnpm test:e2e          # e2e only
```

---

### Prohibited actions

| Prohibited | Reason |
|---|---|
| `npm` or `yarn` | pnpm only |
| `any` type | defeats the type system |
| Silent `catch` blocks | hides failures |
| Mutating function arguments | creates invisible coupling |
| Importing `visualization/` from `core/` | breaks layer separation |
| Parallel `type`/`interface` alongside a Zod schema | duplicates source of truth |
| `new WorkflowBuilder('name')` | old positional API — removed |
| `addState()` | removed; use `addStep`/`addFork`/`addJoin`/`addWait` |
| `state as IForkState` without a kind guard | use discriminated union narrowing |
| Non-null assertions without a justifying comment | hides null-safety assumptions |
| Exported symbol without a TSDoc block | breaks the boundary documentation contract |
| Inline comment explaining *what* code does | noise; rename the identifier instead |

---

### Agent session protocol

After every code change:

1. Run `pnpm lint && pnpm typecheck && pnpm test && pnpm build` — all four must exit clean before declaring the task done.
2. Append a version entry to **Section 4** below and update `README.md` to reflect what changed. Future agents read this file first — leave a clear trail.
3. After updating the version history: if Section 4 contains **5 or more entries**, merge all entries into a single condensed summary that is shorter than the combined text of the individual entries, then replace Section 4 with that single merged entry.

---

## 4. AI Behavioral Guidelines (Karpathy Rules)

1. **Think Before Coding** — State assumptions explicitly before writing any code. If requirements are ambiguous or conflicting, ask a clarifying question rather than guessing.

2. **Simplicity First** — Write the minimum code needed to solve the problem. No over-engineering, no speculative abstractions, no features that weren't asked for.

3. **Surgical Changes** — Touch only the code required to complete the task. Match the surrounding style. Do not refactor, rename, or restructure anything outside the stated scope.

4. **Goal-Driven Execution** — Define what success looks like before starting. Run tests and linters to confirm the goal is met before reporting the task complete.

---

## 5. Project Version History

### [v0.1.0–v0.7.0] 2026-05-24/25 — Foundation through createWorkflow factory

- **v0.1.0**: TSDoc on all exports; `AnyState` discriminated union; Vitest workspace (unit/integration/e2e); 141 tests.
- **v0.2.0**: VitePress `docs/` site (Diátaxis structure).
- **v0.3.0**: `../web-runner/` React SPA — Vite + Tailwind + @xyflow/react; dagre layout; Zod-introspected dispatch forms.
- **v0.4.0** *(breaking)*: Config-First WorkflowBuilder — states declared upfront; typed `addStep`/`addFork`/`addJoin`/`addWait`; removed `addState()`.
- **v0.5.0**: Trimmed public barrel — concrete state/guard classes removed; all guard composition via `Guard` namespace.
- **v0.6.0–v0.7.0** *(breaking)*: `createWorkflow()` factory replaces `new WorkflowBuilder({ states: [...] as const })`; dynamic-workflow integration tests (19 tests); lint fixed across 11 files. 162 tests pass.

### [v0.8.0] 2026-05-25 — Rename SubWorkflowState → WaitState *(breaking)*

- `SubWorkflowState` → `WaitState`; `ISubWorkflowState` → `IWaitState`; `StateKind.SubWorkflow = 'sub-workflow'` → `StateKind.Wait = 'wait'`.
- `addSubWorkflow(id, { subWorkflowName })` → `addWait(id, { externalName })` on `WorkflowBuilder`.
- `instance.resolveSubWorkflow()` → `instance.resolveWait()`; history action key `__resolve_sub_workflow:` → `__resolve_wait:`.
- File renames: `sub-workflow-state.ts` → `wait-state.ts`, `sub-workflow.test.ts` → `wait.test.ts`, `sub-workflows.md` → `wait-state.md`.
- All docs, tests, examples, and web-runner updated. 162 tests pass; all four pipeline steps clean.

### [v0.9.0] 2026-05-26 — Mermaid exporter fixes + web-runner export toolbar

- Fixed spurious `[*] --> forkState : fork` arrow that appeared as a second initial transition in `stateDiagram-v2`.
- Added `direction LR` to Mermaid output for horizontal left-to-right layout.
- Added `classDef active/waiting/completed` blocks so live-status colour annotations render in mermaid.live and GitHub without extra configuration.
- Added export toolbar to `SingleRunner`: **Copy Mermaid** (clipboard), **Download .mmd**, **Download JSON**, **Mermaid Live ↗** (opens with pako-compressed URL via native `CompressionStream`). 167 tests pass; all pipeline steps clean.

### [v0.10.1] 2026-05-27 — Enforce curly braces on all if statements

- Added `"curly": "error"` to `.eslintrc.json` — every `if`/`else` body must have braces, no exceptions. Chosen over `multi-line` to eliminate the Prettier interaction: if a one-liner exceeds `printWidth`, Prettier wraps it to the next line, which `multi-line` would then flag — requiring braces anyway. Always-braces cuts that cycle.
- Ran `pnpm lint:fix` to auto-add braces across all violations, then `pnpm format` to reformat. 167 tests pass; all pipeline steps clean.

### [v0.10.0] 2026-05-27 — Prettier setup + clean-code refactors

- Added Prettier (`^3.8.3`) with `.prettierrc` (printWidth 100, singleQuote, trailingComma all) and `pnpm format` / `pnpm format:check` scripts.
- Ran `pnpm format` across the codebase — removed manual column-alignment in object literals throughout `src/`, `tests/`, `examples/`, and `docs/`.
- Refactored `mermaid.ts`: extracted `stateDeclarationLine()` helper with an exhaustive `switch` to replace a three-branch if-else chain.
- Refactored `json-graph.ts`: replaced three sequential `if (state.kind === ...)` checks with a single `switch` block.
- Expanded `CONTRIBUTING.md` with a comprehensive Code Style section covering formatting, naming, conditionals (early returns, boolean expressions, switch vs if-else), casting (discriminated-union narrowing, non-null assertions, `unknown` over `any`), Zod, error handling, and comments. 167 tests pass; all pipeline steps clean.

### [v0.10.2] 2026-05-27 — Move test helpers out of src/

- Moved `src/testing/helpers.ts` → `tests/helpers.ts`; deleted `src/testing/` directory.
- Updated imports in 5 guard unit test files (`and`, `or`, `not`, `state`, `inject`).
- Updated CLAUDE.md file map and Vitest section to reflect new location. 167 tests pass; all pipeline steps clean.

### [v0.10.3] 2026-05-27 — Mermaid fork/join native notation + direction TD

- Fork states now declared as `state id <<fork>>` and join states as `state id <<join>>` — Mermaid renders these as UML synchronisation bars instead of labelled boxes.
- Changed layout direction from `LR` to `TD` (top-to-bottom).
- Eliminated duplicate fan-in arrows to join states: transitions to join states are skipped from the main transition loop and emitted once without labels via the `requires` block. Removed `✓` labels from join fan-in arrows.
- `kindSuffix()` now returns `''` for Fork and Join (visual distinction is via the bar notation). 167 tests pass; all pipeline steps clean.

### [v0.11.0] 2026-05-27 — Documentation restructure: user guide + developer guide

- Replaced Diátaxis `tutorials/` / `how-to/` / `reference/` / `explanation/` structure with two top-level sections: **User Guide** (`/guide/`, `/examples/`, `/scenarios/`, `/api/`) and **Developer Guide** (`/dev/`).
- Added `logic-workflow/README.md` with project introduction, compile-time type-safety showcase (three annotated error examples), quick-start snippet, and links to full docs.
- New `/guide/` section: introduction with strict-typing selling point, core-concepts page (all four state types with diagrams), installation page.
- New `/examples/` section: four complete copy-pasteable workflows — Purchase Order Approval, Engineer Pre-Departure Checklist (from `examples/engineer-predeparture-checklist.ts`), OCC Disruption SOP (from `examples/occ-disruption-sop.ts`), Station Opening Checklist (from `examples/station-opening-checklist.ts`).
- New `/scenarios/` section: five task-based guides (sequential flow, parallel branches, external wait, guards, persistence) — migrated and tightened from old how-to pages.
- New `/api/` section: five consolidated pages (WorkflowBuilder; WorkflowInstance + DispatchResult; State Types; Guards; Visualization) — replaces six separate reference pages.
- New `/dev/` section: architecture, fixed-point engine, design decisions, contributing guide.
- VitePress config updated with multi-sidebar nav. `pnpm docs:build` exits clean.
