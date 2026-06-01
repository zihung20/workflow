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

### [v0.1.0–v0.25.0 + web-runner v2.0] Cumulative history
- **Core library (v0.1–v0.13):** `WorkflowBuilder` / `WorkflowEngine` / `WorkflowInstance` / `Guard`; four state kinds (`Step`/`Fork`/`Join`/`Wait`); Zod payload validation; `createWorkflow()` factory; Mermaid + JSON-graph exporters; VitePress docs; accumulating `TStates` builder (no upfront array); `createDynamicWorkflow()` escape hatch.
- **Context & history (v0.14–v0.16):** `setContext(schema)` / `createInstance(id, ctx)` / `getContext()`; required-context enforcement at `createInstance`; `HistoryEntry<TContext>` / `InstanceSnapshot<TContext>` generics; `rewind(version)` deep-clones any past snapshot.
- **Generic threading & perf (v0.17–v0.19):** `TContext` and `TStates` threaded through `WorkflowDefinition`, `WorkflowEngine`, `WorkflowInstance`, `Workflow`; `getCurrentStates()` / `getAvailableTransitions()` typed; `getSnapshot()` 48× faster via delta-replay; `tests/perf/` benchmark suite.
- **Typed dispatch surface (v0.20–v0.23):** `TStates` and `TAction` on `DispatchResult` / `TransitionSuccess` / `TransitionBlocked`; full generic chain through `HistoryEntry`, `InstanceSnapshot`, `GuardContext`, `GuardFn`; last boundary cast in `WorkflowInstance.dispatch()` eliminated.
- **Code quality (v0.24):** Exhaustive `kindSuffix()` switch; `typedEntries` used consistently; TSDoc gaps filled; "what" comments removed.
- **Auto-complete inference (v0.25–v0.27):** Fork-target step states with no outgoing transitions are automatically completed on entry — logic lives in the engine's ForkState case (not in `WorkflowDefinition`). No user flag; the fork's own fan-out detects which targets have no work and completes them immediately, letting the downstream join activate via its `requires` list. `occ-disruption-sop.ts` updated: three `NOTIFY_*` actions removed, parallel notification phase resolves in one dispatch.
- **Mermaid join edges (v0.26):** `MermaidExporter` now emits `req --> join` edges for every `JoinState.requires` entry — symmetric with the existing `fork --> target` edges. Both fork fan-out and join fan-in are now fully visible in the diagram without explicit transitions.
- **web-runner v2.0 (2026-05-30):** Landing page, Examples page, full-canvas Visual Designer (bidirectional Monaco↔@xyflow/react sync, live run panel, IntelliSense from `.d.ts`); `@monaco-editor/react`, `monaco-editor`, `react-router-dom` added. Designer updated (2026-06-01): `autoComplete` checkbox for step nodes; join-requires visual edges auto-shown on canvas; drawing to a join auto-adds source to `requires`.
- **JsonGraph structural edges (2026-06-01):** `JsonGraphEdge` gains a `kind` discriminant (`'transition' | 'fork-target' | 'join-requires'`); `JsonGraphExporter` now emits fork fan-out and join fan-in edges alongside transitions — symmetric with `MermaidExporter`. `WorkflowGraph` (Examples runner) renders fork-target edges (purple dashed `⑂ auto`) and join-requires edges (cyan dashed `⑁ requires`); dagre layout also uses these edges for better automatic positioning of fork/join subgraphs.
- **Two-state fork/join pattern (2026-06-01):** Library change: `enterState` now auto-completes ANY dead-end non-terminal StepState (not just fork targets), enabling the two-state branch pattern. All checking-workflow examples updated: fork activates "in-progress" state → explicit dispatch → transitions to "done" state (auto-completes) → join requires the "done" states. Files updated: `engine.ts` (removed `enterForkTarget`, generalized StepState case), `parallel-join.test.ts`, `engineer-predeparture-checklist.ts`, `occ-disruption-sop.ts` (library); `predeparture.ts`, `incident.ts` (including `closeGuard` state reference), `release-pipeline.ts` (web-runner). Engine test `fe-001` retains the instant-resolution pattern to document valid batch-completion use case.
233 tests; all pipeline steps clean.
