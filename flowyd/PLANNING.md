# PLANNING.md

Tracks phase-by-phase implementation plans. Each phase is documented here before any code is written.

---

## Phase 1: VitePress Documentation Site (Diátaxis)

**Status:** COMPLETE ✓

### What was built

- `docs/.vitepress/config.ts` — site config, nav, per-section sidebars, local search
- `docs/index.md` — hero home page with feature grid
- `docs/tutorials/` — section landing + "Build your first workflow" full walkthrough
- `docs/how-to/` — section landing + parallel-branches, sub-workflows, guards, persistence
- `docs/reference/` — section landing + workflow-builder, workflow-instance, state-types, guards, dispatch-result, visualization
- `docs/explanation/` — section landing + architecture, fixed-point-engine, design-decisions
- `package.json` — `docs:dev`, `docs:build`, `docs:preview` scripts; `vitepress ^1.6.4` devDependency
- `.gitignore` — `docs/.vitepress/cache/` and `docs/.vitepress/dist/` excluded
- `README.md` — deleted; VitePress site is now the canonical documentation

---

## Phase 2: Isolated React Web Runner (SPA)

**Status:** COMPLETE ✓ (relocated to sibling position 2026-05-24)

### Final location

`/Users/zihung20/Desktop/workflow/web-runner/` — sibling of `logic-workflow/`, not nested inside it.
Dep: `"logic-workflow": "file:../logic-workflow"` (works because `logic-workflow/package.json` includes `"files": ["dist", "src"]`).

### Goal

Scaffold a completely self-contained single-page application in `web-runner/` that:

- Runs entirely in the browser — no backend, no server
- Links to the parent library via a local file dependency (`"logic-workflow": "file:../"`)
- Instantiates a real `WorkflowInstance` directly in browser memory
- Holds the `InstanceSnapshot` in React state, re-rendering on every dispatch
- Renders the live workflow graph on a React Flow canvas
- Generates action input forms automatically from Zod schema introspection (SDUI)

### Stack

| Concern       | Choice                                                                  |
| ------------- | ----------------------------------------------------------------------- |
| Build tool    | Vite 6 (ESM-native, fast HMR)                                           |
| UI framework  | React 19                                                                |
| Styling       | Tailwind CSS v4 (`@tailwindcss/vite` plugin — no postcss config needed) |
| Graph canvas  | `@xyflow/react` v12 (React Flow rebranded + rewritten for React 19)     |
| State machine | `logic-workflow` (local file link)                                      |
| Schema        | `zod` (peer dep — same version as parent)                               |
| Language      | TypeScript 5.8 strict                                                   |

---

### Directory blueprint

```
web-runner/
├── index.html                        # Vite entry point
├── package.json                      # Local file dep on logic-workflow
├── vite.config.ts                    # React + @tailwindcss/vite plugins; optimizeDeps
├── tsconfig.json                     # strict, moduleResolution: bundler, target: ES2022
└── src/
    ├── index.css                     # @import "tailwindcss"; — all Tailwind needs in v4
    ├── main.tsx                      # ReactDOM.createRoot, mounts <App />
    ├── App.tsx                       # Orchestrator — see spec below
    ├── workflow/
    │   └── demo-workflow.ts          # Exports a compiled Workflow and initial guard map
    ├── components/
    │   ├── WorkflowGraph.tsx         # @xyflow/react canvas — see spec below
    │   ├── StateNode.tsx             # Custom XYFlow node component
    │   ├── DynamicForm.tsx           # SDUI form from Zod schema — see spec below
    │   └── HistoryPanel.tsx          # Scrollable audit log from snapshot.history
    └── lib/
        └── zod-introspect.ts         # Pure Zod-walking utilities used by DynamicForm
```

---

### File specifications

#### `web-runner/package.json`

```json
{
  "name": "web-runner",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "logic-workflow": "file:../",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "@xyflow/react": "^12.0.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "@tailwindcss/vite": "^4.0.0",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.8.0",
    "vite": "^6.0.0"
  }
}
```

Key changes from older plan:

- **`react` / `react-dom` 19** — no `autoprefixer` or `postcss` needed; Tailwind v4 handles this internally
- **`@xyflow/react` v12** — replaces the retired `reactflow` v11 package; full React 19 compatibility, new `useNodesState` / `useEdgesState` hooks API
- **`@tailwindcss/vite` v4** — Vite plugin replaces the postcss pipeline entirely; `tailwind.config.ts` is gone; configuration lives in CSS via `@theme` blocks if needed
- **`typescript` 5.8** — includes `erasableSyntaxOnly`, `noUncheckedSideEffectImports`, and updated `moduleResolution` defaults

The `"file:../"` dep resolves to the parent package's `dist/` output (built with `pnpm build`). The `vite.config.ts` adds the parent `dist/` to `optimizeDeps.include` so Vite pre-bundles it correctly.

---

#### `src/workflow/demo-workflow.ts`

Exports a fully compiled `Workflow` built from the engineer pre-departure checklist (or another bundled example). Also exports a `getGuards()` factory that returns pre-wired guard implementations so `App.tsx` can inject them without coupling itself to domain logic.

```ts
export const demoWorkflow: Workflow<typeof DemoActions>;
export function wireGuards(inst: WorkflowInstance<typeof DemoActions>): void;
```

The workflow must be buildable entirely from the types in `logic-workflow` — no Node.js APIs, no file I/O.

---

#### `src/App.tsx` — Orchestrator

Responsibilities:

1. Creates `demoWorkflow.createInstance('runner-001')` on first mount and calls `wireGuards(inst)`.
2. Holds `snapshot: InstanceSnapshot` in `useState`. The instance object is stored in a `useRef` (mutable, not reactive).
3. Exposes a `dispatch(action, payload)` callback that:
   - Calls `inst.dispatch(action, payload)`
   - On `result.success === true`: calls `setSnapshot(inst.getSnapshot())`
   - On failure: surfaces `result.reason` as a dismissible toast
4. Passes `snapshot` and `dispatch` down via React context (no prop drilling).
5. Layout: two-column flex — left: `<WorkflowGraph />` (takes remaining width), right: `<DynamicForm />` + `<HistoryPanel />` stacked vertically.

State shape:

```ts
interface RunnerContext {
  workflow: Workflow<AnyActions>; // stable ref, never changes
  snapshot: InstanceSnapshot; // updated after every successful dispatch
  dispatch: (action: string, payload: unknown) => Promise<void>;
  lastError: string | null; // 'guard-failed' | 'terminal-state' | null
}
```

---

#### `src/components/WorkflowGraph.tsx` — XYFlow Canvas

Data flow:

```
workflow.getDefinition()  ─┐
                            ├─▶ JsonGraphExporter.export(def, snapshot) ─▶ JsonGraph
snapshot                  ─┘
```

`JsonGraph.nodes` → mapped to `@xyflow/react` `Node[]`:

- `position` computed via a BFS topological sort (column = depth, row = sibling index). No external layout lib needed — the graph is a DAG with bounded width.
- Each node gets `type: 'stateNode'` pointing to `StateNode.tsx`.
- Node `data` carries: `{ label, kind, status, isInitial, isTerminal, targets?, join? }`.

`JsonGraph.edges` → mapped to `@xyflow/react` `Edge[]`:

- `label` = the action name
- `animated` = `true` when the source state's status is `active`
- `style` — dashed stroke when `hasGuard: true`

`StateNode.tsx` renders a rounded card using `@xyflow/react`'s `Handle` component for connection points:

- Background by `status`: `idle`=slate-100, `active`=blue-500, `waiting`=amber-400, `completed`=green-500
- Icon suffix by `kind`: ⑂ fork, ⑁ join, ⤴ sub-workflow, none for step
- Bold label, small kind chip below

The canvas uses the v12 `<ReactFlow>` component (import from `@xyflow/react`) with `fitView`, `<Controls />`, and `<MiniMap />`. No node dragging — `nodesDraggable={false}`. State is driven by the form only.

---

#### `src/lib/zod-introspect.ts` — Schema Walker

Pure utility module. Walks a `ZodTypeAny` and returns a `FieldDescriptor[]`:

```ts
type FieldDescriptor =
  | { kind: 'string'; name: string; optional: boolean }
  | { kind: 'number'; name: string; optional: boolean }
  | { kind: 'boolean'; name: string; optional: boolean }
  | { kind: 'enum'; name: string; optional: boolean; options: string[] }
  | { kind: 'unknown'; name: string; optional: boolean }; // fallback → free-text
```

Implementation strategy using Zod's first-party type names (accessed via `schema._def.typeName` against `ZodFirstPartyTypeKind`):

```
ZodObject   → recurse into .shape entries, flatten into FieldDescriptor[]
ZodOptional → unwrap inner, set optional: true
ZodString   → { kind: 'string' }
ZodNumber   → { kind: 'number' }
ZodBoolean  → { kind: 'boolean' }
ZodEnum     → { kind: 'enum', options: schema._def.values }
ZodDefault  → unwrap inner, carry default value
*           → { kind: 'unknown' }   (safe fallback: renders a text input)
```

Exported function signature:

```ts
export function describeSchema(schema: ZodTypeAny, parentKey?: string): FieldDescriptor[];
```

This is a pure function with no side-effects. It is tested independently of the React tree.

---

#### `src/components/DynamicForm.tsx` — SDUI Action Form

Reads from `RunnerContext`:

- `snapshot` → `inst.getAvailableTransitions()` gives the list of action names currently dispatchable
- `workflow.getDefinition().actionSchemas` → keyed by action name, gives `ZodSchema<unknown>`

Renders:

1. **Action selector** — a `<select>` or button group listing available actions. Disabled when `snapshot.isTerminal`.
2. **Field list** — calls `describeSchema(actionSchema)` for the selected action and renders one input per `FieldDescriptor`:
   - `string` → `<input type="text">`
   - `number` → `<input type="number">`
   - `boolean` → `<input type="checkbox">`
   - `enum` → `<select>` populated with `options`
   - `unknown` → `<input type="text">` (user types raw JSON)
3. **Submit button** — collects the form's controlled state into a plain object, calls `ctx.dispatch(selectedAction, payload)`.
4. **Error badge** — shows `ctx.lastError` in red when non-null, auto-clears on next successful dispatch.

All inputs are controlled (value + onChange). The collected payload object is typed as `Record<string, unknown>` before being handed to `dispatch` — Zod validates it inside the engine before any state change.

---

#### `src/components/HistoryPanel.tsx`

Maps `snapshot.history` (most-recent-first) into a scrollable list. Each entry shows:

- Action name (bold)
- Timestamp (relative, e.g. "3s ago")
- Entered states (green chips) / Exited states (gray chips)

---

### Build / dev instructions (to be added to CLAUDE.md after execution)

```sh
# One-time: build the parent library first
pnpm build

# Then in web-runner/:
pnpm install
pnpm dev      # → http://localhost:5173
pnpm build    # production bundle → web-runner/dist/
```

The parent library must be rebuilt (`pnpm build` at the root) whenever source files in `src/` change, because the file dep resolves to `dist/`.

---

### Architecture constraints honoured

- `web-runner/` is a fully isolated package — it does not share `node_modules` with the parent
- It imports from `logic-workflow` (the compiled package), never from `../src/` directly — the layer boundary is respected
- No backend, no server, no Node.js APIs in the browser bundle
- No `any` — all Zod introspection uses `unknown` narrowed through `instanceof` / `_def.typeName` checks
- The parent package's `pnpm` lockfile is not touched; `web-runner/` maintains its own `pnpm-lock.yaml`

---

## Phase 3: Advanced Testing, Type Soundness, and Architecture Optimization

**Status:** COMPLETE ✓

### Objectives

1. **Zero-Casting Mandate** — eliminate every eliminatable type assertion from the core library.
2. **Strict Testing Pyramid** — split the test suite into named unit / integration / e2e layers.
3. **Domain-Driven Structure** — co-locate tests with their source modules; delete dead code.

---

### Part 1: Discriminated Union & Cast Elimination

**Root cause of casts:** `WorkflowDefinition.states` was typed `ReadonlyMap<string, IState>`.
`IState.kind` was the broad `StateKind` enum, so TypeScript could not narrow the value to
`IForkState` / `IJoinState` / `ISubWorkflowState` after a `kind` check — every accessor required
an explicit `as` cast.

**Fix:**

- `src/types/state.ts` — added `IStepState` (with `kind: StateKind.Step` as a literal type)
  and the union `AnyState = IStepState | IForkState | IJoinState | ISubWorkflowState`.
- `src/types/workflow.ts` — `WorkflowDefinition.states: ReadonlyMap<string, AnyState>`.
- `src/types/index.ts`, `src/index.ts` — re-export `IStepState` and `AnyState`.
- `src/states/step-state.ts` — explicitly `implements IStepState`.
- `src/core/registry.ts` — `StateRegistry` uses `Map<string, AnyState>`.
- `src/core/builder.ts` — `addState<S extends AnyState>`; inline-import casts in `build()`
  removed (kind checks now narrow automatically).
- `src/core/engine.ts` — removed `state as IJoinState` and `state as IForkState`.
- `src/core/instance.ts` — removed `state as ISubWorkflowState` and dead `void` line.
- `src/visualization/mermaid.ts` — removed 3 state casts + `status as StateStatus`.
- `src/visualization/json-graph.ts` — removed 3 state casts.

**Result:** 11 eliminatable casts removed. 6 remain at explicit storage-boundary or
generic-accumulation sites (all justified by comments):

| Cast                                          | Location               | Reason                                                                              |
| --------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------- |
| `this as unknown as WorkflowBuilder<...>` × 2 | `builder.ts`           | Generic accumulation — TypeScript cannot widen the generic without an explicit cast |
| `schema as ZodSchema<unknown>`                | `builder.ts`           | Contravariant storage boundary                                                      |
| `fn as GuardFn<unknown>`                      | `registry.ts`          | Contravariant storage boundary                                                      |
| `transition.guard as GuardFn/IGuard<unknown>` | `builder.ts`           | Contravariant storage boundary                                                      |
| `ctx as GuardContext<T>`                      | `guards/primitives.ts` | Type restoration after validated erasure                                            |

**Dead code deleted:**

- `src/types/node.ts` — unused and violated the layer rule (imported from `core/`).
- `src/core/context.ts` — only referenced by the now-deleted `node.ts`.

---

### Part 2: Vitest Workspace — Three Named Projects

**`vitest.workspace.ts`** defines three isolated test runners:

| Project       | Include glob                     | Purpose                                     |
| ------------- | -------------------------------- | ------------------------------------------- |
| `unit`        | `src/**/*.test.ts`               | Pure in-memory tests co-located with source |
| `integration` | `tests/integration/**/*.test.ts` | Cross-module state-machine workflows        |
| `e2e`         | `tests/e2e/**/*.test.ts`         | System-wide invariant assertions            |

**`package.json` scripts added:**

- `test:unit` — `vitest run --project unit`
- `test:integration` — `vitest run --project integration`
- `test:e2e` — `vitest run --project e2e`

**`tsconfig.build.json`** — added `src/**/*.test.ts` and `src/testing` to `exclude` so tsup's
`tsc` pass never compiles co-located tests into the production bundle.

---

### Part 3: Test Co-location and New Tests

**Moved to `src/` (unit project):**

| Old path                           | New path                   |
| ---------------------------------- | -------------------------- |
| `tests/guards/*.test.ts` (5 files) | `src/guards/*.test.ts`     |
| `tests/core/builder.test.ts`       | `src/core/builder.test.ts` |
| `tests/core/engine.test.ts`        | `src/core/engine.test.ts`  |
| `tests/helpers.ts`                 | `src/testing/helpers.ts`   |

**New unit tests (co-located in `src/`):**

| File                                    | What it covers                                                                                         |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `src/types/state.test.ts`               | `StateKind` / `StateStatus` enum string values and member counts                                       |
| `src/states/step-state.test.ts`         | Constructor, `kind`, label default, empty-id guard                                                     |
| `src/states/fork-state.test.ts`         | Empty targets throws, targets frozen copy, label option                                                |
| `src/states/join-state.test.ts`         | `all` / `any` / quorum modes, empty requires throws                                                    |
| `src/states/sub-workflow-state.test.ts` | `subWorkflowName` stored, label option                                                                 |
| `src/core/registry.test.ts`             | Duplicate registration, missing get, snapshot independence, guard overwrite                            |
| `src/core/instance.test.ts`             | Snapshot round-trip, `getAvailableTransitions`, `canExecute` dry-run, `resolveSubWorkflow` error paths |

**New E2E invariant tests (`tests/e2e/workflow-invariants.test.ts`):**

21 tests asserting structural invariants that must hold for any workflow:

- Version counter starts at 0, increments by 1 per successful dispatch, unchanged on failure
- History length equals successful dispatch count; timestamps are ISO-8601 and in-range
- `JSON.parse(JSON.stringify(snapshot))` round-trip preserves all fields
- `workflow.restoreInstance(snapshot)` produces a functionally equivalent instance
- Terminal state rejects all further dispatches regardless of action, version unchanged
- `getAvailableTransitions()` reflects only actions from currently active states, including post-fork multi-branch availability
- SubWorkflow full lifecycle: `ENTER → waiting → resolveSubWorkflow → active → dispatch out`; external snapshot stored in history

---

### Verification

```sh
pnpm typecheck          # must exit 0
pnpm test:unit          # 44 tests
pnpm test:integration   # 30 tests
pnpm test:e2e           # 21 tests
pnpm test               # 141 total, all green
pnpm build              # dist/ clean, no test files bundled

# Confirm no eliminatable casts remain in src/
grep -rn ' as I[A-Z]\| as StateStatus' src/ | grep -v '\.test\.'
```

**Test count: 74 → 141. No API surface changes.**

---

get a good name

