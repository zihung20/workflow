# CLAUDE.md — Project Law

This file is the authoritative reference for every agent and developer working in this codebase. Read it before touching any file. The rules here override instinct, habit, and convention.

---

## 1. System Overview

`flowyd` is a TypeScript library for building typed, auditable workflow state machines. It exposes a fluent `WorkflowBuilder` API that enforces state-ID correctness at compile time, a pure stateless `WorkflowEngine` that executes transitions, and pluggable guard functions for async business-rule evaluation. Snapshots are plain JSON — the library has no opinion on storage.

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

### Backward compatibility

**This package has not been published to npm. Backward compatibility is not a concern.** Breaking changes to public APIs, snapshot formats, and type signatures are acceptable. Do not add compatibility shims, migration code, or deprecation warnings — just make the change.

---

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

### Accumulating Builder

State IDs are inferred from `addStep`, `addFork`, `addJoin`, and `addWait` calls — each registration widens the `TStates` union by one literal. No upfront `states` array is needed. `setInitial`, `setTerminal`, `addTransition`, and the `targets`/`requires` options are all constrained to the accumulated set — typos fail at compile time.

```ts
const wf = createWorkflow({ name: 'my-workflow' })
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
- Use `createWorkflow({ name })` — `TStates` starts as `never` and grows with each state-registration call.
- Never use `new WorkflowBuilder({...})` directly.
- Every state must be registered via `addStep`, `addFork`, `addJoin`, or `addWait`. There is no `addState` escape hatch.
- **Ordering rule for fork/join:** `addFork.targets` and `addJoin.requires` are constrained to states already in `TStates`. Register branch/prerequisite states *before* the fork or join that references them — unregistered IDs are compile-time errors.
- `defineAction` and the four state-registration methods return a new generic specialization; the runtime object is unchanged, only the TypeScript type widens. `setInitial`, `setTerminal`, and `addTransition` return `this`.
- **Dynamic workflows** (state IDs only known at runtime): cast to a wide builder — `createWorkflow({ name }) as unknown as WorkflowBuilder<Record<string, unknown>, string>` — and rely on `build()` for validation.

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

`MermaidExporter` and `JsonGraphExporter` live in `src/visualization/` and are exported from `"flowyd/visualization"`. Bundlers can tree-shake this from applications that don't use it. `core/` has zero knowledge that visualization exists.

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
| `states: [...]` in `createWorkflow` | removed; `TStates` accumulates from `addStep`/`addFork`/`addJoin`/`addWait` |
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

### [v0.1.0–v0.13.0] Foundation & API shape
- Core library: `WorkflowBuilder`, `WorkflowEngine`, `WorkflowInstance`, `Guard` factory; four state types (`Step`/`Fork`/`Join`/`Wait`); Zod payload validation.
- `createWorkflow()` factory (v0.7.0); `WaitState` rename (v0.8.0, breaking).
- Mermaid + JSON-graph exporters (v0.9.0–v0.10.3); VitePress docs (v0.11.0).
- Accumulating `TStates` builder — no upfront `states` array (v0.12.0, breaking); `createDynamicWorkflow()` escape hatch (v0.13.0).

### [v0.14.0–v0.16.0] Context & history
- Caller-owned typed context: `setContext(schema)` / `createInstance(id, ctx)` / `getContext()`; Zod validation; guard access via `ctx.context` (v0.14.0).
- Conditional rest-params enforce required context at `createInstance` when schema is declared (v0.15.0).
- `HistoryEntry<TContext>` / `InstanceSnapshot<TContext>` generics; `rewind(version)` returns a deep-cloned snapshot at any past version with accurate context (v0.16.0).

### [v0.17.0–v0.19.0] Generic threading & performance
- `TContext` threaded through `WorkflowDefinition` and `WorkflowEngine`; only remaining boundary cast is in `build()` (v0.17.0).
- `TStates` threaded to `WorkflowInstance` and `Workflow`; `getCurrentStates()` / `getAvailableTransitions()` typed; `TStates = string` default preserves dynamic workflow compat (v0.18.0).
- `getSnapshot()` 48× faster via delta-replay `rewind()` instead of storing full status snapshots; `tests/perf/` benchmark suite added; no-compat policy documented in Section 3 (v0.19.0).

### [v0.20.0–v0.23.0] Fully typed dispatch surface
- `TransitionSuccess` / `TransitionBlocked` carry `TStates`; `DispatchResult` threaded; delta-replay tests for `WaitState`, `resolveWait`, fork/join mid-execution (v0.20.0).
- `TAction` added to `TransitionSuccess` / `TransitionBlocked` / `DispatchResult` so `result.action` narrows to the dispatched literal (v0.21.0).
- `TStates` threaded to `ReadonlyInstanceState`, `HistoryEntry`, `InstanceSnapshot`, `GuardContext`, `GuardFn`, `FnGuard`, `injectGuard`, `resolveWait` (v0.22.0).
- `TStates` threaded into `WorkflowEngine` itself and all internal helpers; last boundary cast in `WorkflowInstance.dispatch()` eliminated; remaining casts are all at unavoidable `Object.fromEntries` / type-erasure boundaries (v0.23.0).

### [v0.24.0] 2026-05-29 — Code-quality pass
- Deleted 6 "what" comments in `mermaid.ts`; removed cosmetic section-divider comments in `instance.ts`.
- `kindSuffix()` switch made exhaustive: explicit `StateKind.Step` case replaces `default`, so a future new kind fails at compile time.
- `getAvailableTransitions()` now uses `typedEntries` consistently (was using raw `Object.entries`).
- Added TSDoc to `StateRegistry.has()`; added `@returns` tag to `Workflow.getDefinition()`.

233 tests; all pipeline steps clean.

### [web-runner v2.0] 2026-05-30 — Full showcase website + Visual Designer
**web-runner only — no changes to `flowyd/` library.**

- **Landing page** (`pages/HomePage.tsx`): hero section with code snippet, 4 feature cards, example gallery cards, designer CTA.
- **Examples page** (`pages/ExamplesPage.tsx`): React Router v6 routing; hash-based SPA with lazy-loaded pages.
- **Visual Designer** (`pages/DesignerPage.tsx` + `designer/`):
  - Interactive @xyflow/react canvas: drag nodes, draw transitions, delete with Backspace.
  - Toolbar to add Step / Fork / Join / Wait nodes.
  - Floating config panels for selected node (id, label, kind, initial/terminal, fork targets, join requires/mode, wait external name) and selected edge (action name, guard body).
  - Canvas → Code sync: `codeGenerator.ts` emits canonical `createWorkflow()` TypeScript on every canvas change.
  - Code → Canvas sync (debounced 500ms): Monaco TypeScript worker transpiles user code, `codeEvaluator.ts` executes via `new Function()` with injected flowyd/zod globals, reconciles canvas state.
  - Bidirectional loop guard: `editSourceRef` prevents infinite canvas↔code update cycles.
  - Run panel: click ▶ to evaluate current code and execute the workflow live using existing `SingleRunner`.
- **Monaco Editor** (`designer/code/CodeEditor.tsx`): `@monaco-editor/react` + local workers via Vite `?worker`; hand-written ambient `flowyd` + `zod` type declarations registered via `addExtraLib` → full IntelliSense.
- **Fixed workflow files**: removed stale `states: [...]` property from `createWorkflow()` in all four workflow files; fixed `predeparture.ts` fork-target ordering (branch states registered before the fork that references them).
- **New deps**: `@monaco-editor/react@4.7.0`, `monaco-editor@0.52.2`, `react-router-dom@6.30.4`.
