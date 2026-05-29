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

### [v0.1.0–v0.16.0] 2026-05-24/28 — Full project history (condensed)

Core library built iteratively: typed `WorkflowBuilder` (accumulating `TStates`/`TActions`/`TContext` generics), pure stateless `WorkflowEngine`, `WorkflowInstance` with snapshot round-trip, `Guard` factory, four state types (`Step`/`Fork`/`Join`/`Wait`), Zod payload validation. Key milestones: `createWorkflow()` factory (v0.7.0); `WaitState` rename (v0.8.0, breaking); Mermaid + JSON-graph exporters (v0.9.0–v0.10.3); VitePress docs (v0.11.0); accumulating `TStates` builder — no upfront `states` array (v0.12.0, breaking); `createDynamicWorkflow()` escape hatch (v0.13.0); caller-owned typed context with `setContext(schema)` / `createInstance(id, ctx)` / `getContext()`, Zod validation, guard access via `ctx.context` (v0.14.0); conditional rest-params enforce required context at `createInstance` when schema is declared (v0.15.0); `HistoryEntry<TContext>` / `InstanceSnapshot<TContext>` generics, `getContext()` returns `TContext | undefined` without a cast, each history entry records `stateStatuses` and `context` at dispatch time, `WorkflowInstance.rewind(version)` returns a deep-cloned independent snapshot for any past version with accurate context (v0.16.0); **full generic threading** — `WorkflowDefinition<TContext>` carries `contextSchema?: ZodSchema<TContext>` so `parse()` returns `TContext` directly; `WorkflowEngine.dispatch<TContext>` infers TContext from the snapshot parameter and returns `DispatchResult<TContext>` (= `TransitionSuccess<TContext> | TransitionBlocked`); eliminates the `as TContext` cast in `setContext`/`createInstance` and the `as InstanceSnapshot<TContext>` cast in `dispatch` — the only remaining boundary cast is in `build()` where the type-erased builder schema is sealed into the typed definition (v0.17.0); **`TStates` threaded to instance** — `WorkflowInstance<TActions, TContext, TStates>` and `Workflow<TActions, TContext, TStates>` now carry the accumulated state-ID union; `getCurrentStates()` returns `TStates[]`; `getAvailableTransitions()` returns `(keyof TActions & string)[]`; dynamic workflows remain compatible via `TStates = string` default (v0.18.0); **`getSnapshot()` performance fix** — removed redundant `stateStatuses` field from `HistoryEntry` (it duplicated what `exitedStates`/`enteredStates` already express); `rewind()` now replays deltas to reconstruct past state instead of O(1) lookup — `getSnapshot()` on a 500-state chain is 48× faster (18.9ms → 0.39ms); added `tests/perf/` benchmark suite and `pnpm test:perf` script; no-backward-compat policy documented in Section 3 (v0.19.0); **typed dispatch result** — `TransitionSuccess<TContext, TStates>` narrows `enteredStates`/`exitedStates` to `readonly TStates[]`; `TransitionBlocked<TStates>` narrows `activeStates` to `readonly TStates[]`; `DispatchResult` threads `TStates`; `WorkflowInstance.dispatch()` returns `DispatchResult<TContext, TStates>` with a safe boundary cast from the type-erased engine; added rewind delta-replay tests (WaitState, resolveWait, fork/join mid-execution) and compile-time type tests for dispatch result arrays (v0.20.0); **typed action on dispatch result** — `TransitionSuccess` and `TransitionBlocked` now carry `TAction extends string` so `result.action` narrows to the dispatched literal (e.g. `'SUBMIT'` not `string`); `DispatchResult` threads all three generics; examples fixed to use `const` per dispatch where the result is inspected, `await` (discarding result) elsewhere (v0.21.0); **full TStates/TAction threading** — `ReadonlyInstanceState<TStates>` narrows all state query methods; `HistoryEntry<TContext, TStates>` narrows `exitedStates`/`enteredStates`; `InstanceSnapshot<TContext, TStates>` narrows `stateStatuses` keys and history entries; `GuardContext<TPayload, TContext, TStates>` narrows `instanceState`; `GuardFn<TPayload, TContext, TStates>` threads TStates to inline guards; `FnGuard` carries TStates through its cast; `addTransition` guard option uses `GuardFn<..., TStates>` so inline guards see typed state IDs; `injectGuard` accepts `GuardFn<..., TStates>`; `resolveWait` parameter narrowed to `TStates`; all boundary casts are safe by registration invariant; engine/guard-impl/registry layers remain type-erased via `string` default (v0.22.0); **typed engine** — `TransitionDefinition<TStates>` and `WorkflowDefinition<TContext, TStates>` now carry `TStates`; `WorkflowEngine.dispatch<TContext, TStates, TAction>` returns `DispatchResult<TContext, TStates, TAction>` directly; `MutableStatusMap<TStates>` and `EvaluationResult<TStates>` are generic; internal engine helpers (`computeTransitions`, `enterState`, `joinConditionMet`, `buildGuardContext`) all thread `TStates`; the `result as DispatchResult<TContext, TStates, K>` cast in `WorkflowInstance.dispatch()` is eliminated; remaining boundary casts: `Object.fromEntries` (unavoidable TS limitation), `IGuard.evaluate` (intentional guard type-erasure), `ForkState.targets as TStates` / `IJoinState.requires as TStates` (state-interface erasure), and `getDefinition()` widening to `string` for the vis layer (v0.23.0). 233 tests; all pipeline steps clean.
