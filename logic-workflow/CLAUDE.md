# CLAUDE.md — Project Law

This file defines inviolable rules for this codebase. Treat every module as kernel code: every boundary is a contract, every failure is explicit, and no assumption goes unvalidated.

---

## Package Manager

**Use `pnpm` exclusively. No exceptions.**

```sh
# Correct
pnpm install
pnpm add <pkg>
pnpm run build
pnpm test

# Never
npm install
yarn add
```

If a `package-lock.json` or `yarn.lock` appears, delete it and investigate why it was created.

---

## Tech Stack

- **Language:** TypeScript. Strict mode is non-negotiable (see rules below).
- **Runtime validation:** Zod. Every external boundary — node inputs, node outputs, workflow inputs, workflow outputs — must be guarded by a Zod schema.
- **Derive types from schemas, not the reverse.** Use `z.infer<typeof MySchema>` as the TypeScript type. Do not write a separate `type` or `interface` and then mirror it in a Zod schema.

```ts
// Correct
const UserSchema = z.object({ id: z.string(), score: z.number() });
type User = z.infer<typeof UserSchema>;

// Never
interface User { id: string; score: number; }
const UserSchema = z.object({ id: z.string(), score: z.number() }); // duplicated source of truth
```

---

## TypeScript Strict Mode

The following `compilerOptions` must remain enabled at all times. Do not weaken them:

```json
"strict": true,
"exactOptionalPropertyTypes": true,
"noUncheckedIndexedAccess": true,
"noImplicitOverride": true
```

- No `any`. If a type is genuinely unknown, use `unknown` and narrow it explicitly.
- No non-null assertions (`!`) unless accompanied by a comment explaining why the value is provably non-null at that call site.
- No `as` type casts except at layer boundaries (e.g. casting `AnyNode` back to a concrete type inside the registry after a `kind` guard). Every such cast must have a comment.

---

## Kernel-Level Modularity

The codebase is divided into four layers. **Dependencies flow in one direction only — downward.**

```
visualization/
    ↓ (imports from)
core/
    ↓
nodes/
    ↓
types/ + schemas/
```

**Hard rules:**

- `core/` must not import anything from `visualization/`. The engine has no knowledge that visualization exists.
- `nodes/` must not import from `core/` (except `ExecutionContext`, which is a pure data carrier).
- `types/` and `schemas/` must not import from any other layer.
- Cross-layer communication happens through the interfaces in `types/` — never through concrete classes reaching across layers.

Violating this produces invisible coupling that turns into architectural debt. Treat it as a build error even when the compiler does not.

---

## Defensive Programming

### No silent failures

Every function that can fail must signal it. No returning `null`, `undefined`, or `false` to indicate an error — throw a typed error with a clear message.

```ts
// Correct
function getNode(id: string): AnyNode {
  const node = this.nodes.get(id);
  if (!node) throw new Error(`Node "${id}" not found in registry`);
  return node;
}

// Never
function getNode(id: string): AnyNode | undefined {
  return this.nodes.get(id); // caller silently ignores undefined
}
```

### No swallowed exceptions

`try/catch` blocks must either re-throw or wrap and re-throw. Logging and continuing is not acceptable.

```ts
// Correct
try {
  result = await node.execute(input, ctx);
} catch (err) {
  throw new WorkflowExecutionError(`Node "${nodeId}" failed`, { cause: err });
}

// Never
try {
  result = await node.execute(input, ctx);
} catch {
  result = defaultValue; // failure hidden from the caller
}
```

### No side-effect mutations

Functions must not mutate arguments or shared state outside their explicit scope. Node execution is a pure transformation: given input, produce output. The `ExecutionContext` is the only sanctioned place to write runtime state, and only the engine may write to it.

```ts
// Never — mutating the input object
async execute(input: MyType): Promise<MyType> {
  input.value = 42; // corrupts the caller's data
  return input;
}

// Correct — return a new object
async execute(input: MyType): Promise<MyType> {
  return { ...input, value: 42 };
}
```

---

## Strict Interfaces — Data Passing Between Nodes

Every value crossing a node boundary must be validated. This is not optional even when the upstream node already validated its output.

**Rule:** `BaseNode.runFn` validates both input (before calling `fn`) and output (before returning). This validation must never be bypassed by calling `fn` directly.

```ts
// Correct — always go through runFn
async execute(input: TIn, ctx: ExecutionContext): Promise<TOut> {
  return this.runFn(this.fn, input, ctx);
}

// Never — skips schema validation
async execute(input: TIn, ctx: ExecutionContext): Promise<TOut> {
  return this.fn(input, ctx);
}
```

Port values stored in `ExecutionContext` are typed as `unknown`. When retrieved, they must be parsed through the receiving node's `inputSchema` before use. The engine is responsible for orchestrating this; nodes must not reach into the context directly.

---

## Documentation & Commenting Strategy

Comments are part of the contract, not decoration. Apply the same discipline here as everywhere else: be precise, be minimal, and explain only what the code cannot say for itself.

### No line-by-line noise

Do not annotate obvious syntax. If a reader who knows TypeScript cannot understand a line from its identifiers alone, the identifiers are wrong — rename them, do not comment them.

```ts
// Never — the code already says this
const node = this.nodes.get(id); // get the node from the map

// Never — the name is the documentation
i++; // increment i
```

### Document the boundaries with TSDoc

Every **exported** class, interface, type alias, and function must carry a TSDoc block. The contract at a public boundary is the hardest thing to reconstruct from implementation alone, so it must be stated explicitly.

A TSDoc block must answer:
- **What** the abstraction does (one sentence, imperative mood)
- **`@param`** for every parameter — name, expected shape, and any constraint
- **`@returns`** describing the shape and meaning of the return value
- **`@throws`** for every error condition that callers must handle

```ts
/**
 * Looks up a registered node by its unique ID.
 *
 * @param id - The node's unique identifier within this registry.
 * @returns The matching node cast to `AnyNode`.
 * @throws {Error} If no node with `id` has been registered.
 */
get(id: string): AnyNode { ... }
```

Private and internal methods do not need TSDoc unless their purpose is genuinely non-obvious to a reader who has just read the class's public TSDoc.

### Explain the 'Why' with inline comments

Inside a function body, only write a comment when the **reason** for a decision would surprise an informed reader. The comment must explain why, not what.

```ts
// Never — what is obvious from the code
const branch = output === true ? 'true' : 'false';

// Correct — why is not obvious: skipping is the mechanism that makes
// branching work without explicit conditional execution logic in the engine
if (!ctx.hasPortValue(nodeId, 'input')) continue;
```

Complexity that requires a comment is a signal to consider refactoring first. If the refactor would obscure performance or correctness, keep the comment and document that trade-off explicitly.

### Summary table

| Location | Rule |
|---|---|
| Exported class / interface / type | TSDoc required |
| Exported function / method | TSDoc required |
| Private / internal method | TSDoc only if genuinely non-obvious |
| Complex logic block inside a function | One inline `// why` comment |
| Obvious syntax | No comment |

---

## What Not to Do

| Prohibited | Reason |
|---|---|
| `npm` or `yarn` commands | pnpm only |
| `any` type | defeats the type system |
| Silent `catch` blocks | hides failures |
| Mutating function arguments | creates invisible coupling |
| Importing `visualization/` from `core/` | breaks layer separation |
| Writing a type alongside its Zod schema | duplicates the source of truth |
| Calling node `fn` directly, bypassing `runFn` | skips boundary validation |
| Non-null assertions without a justifying comment | hides null-safety assumptions |
| Exported symbol without a TSDoc block | breaks the boundary documentation contract |
| Inline comment explaining *what* code does | noise; rename the identifier instead |

---

## Agent Session Protocol

**Standing rule for every agent session:** After making any code change, update this section and `README.md` to reflect what was done. Future agents read this file first — leave a clear trail.

Format for each entry:

```
### YYYY-MM-DD — <short title>
- What changed and why (file paths + reason)
- Any invariants introduced or broken
- Known follow-ups or open questions
```

---

## Session History

### 2026-05-24 — Initial TSDoc pass + examples expansion

- `src/states/base.ts`, `step-state.ts`, `fork-state.ts`, `join-state.ts`, `sub-workflow-state.ts`:
  Added full TSDoc on all exported classes (`@param`, `@throws`, `@example`). The `TId` template
  parameter explanation on `BaseState` clarifies why the generic exists (compile-time state-ID
  union accumulation in `WorkflowBuilder`).
- `src/core/builder.ts`: Added comprehensive TSDoc on every public method, including the call-order
  contract, all structural checks in `build()`, and the inline-guard-vs-IGuard overload on
  `addTransition`. Comments on the identity-preserving `return this as unknown as …` casts
  explain why the unsafe cast is safe (only the generic parameter changes, not the runtime object).
- `tests/core/builder.test.ts`: Expanded structural-validation tests for `ForkState` target and
  `JoinState` requires checks; added `@ts-expect-error` annotations with explanations.
- `examples/engineer-predeparture-checklist.ts`, `examples/station-opening-checklist.ts`:
  Updated to match current API surface and demonstrate current best practices.
- `examples/occ-disruption-sop.ts`: Full MRT OCC service-disruption SOP — demonstrates
  multi-role `Guard.inject`, parallel notification `ForkState`/`JoinState`, `SubWorkflowState`
  + `resolveSubWorkflow`, and `JsonGraphExporter`. Run with `npx tsx examples/occ-disruption-sop.ts`.

**No API surface changes.** All existing tests pass.

### 2026-05-24 — Phase 1: VitePress documentation site (Diátaxis)

- `docs/` — new directory tree. All content files; no live imports from `src/`.
  - `docs/.vitepress/config.ts` — site config with nav + per-section sidebar
  - `docs/index.md` — hero home page with feature grid
  - `docs/tutorials/` — `index.md`, `first-workflow.md` (full purchase-order walkthrough)
  - `docs/how-to/` — `index.md`, `parallel-branches.md`, `sub-workflows.md`, `guards.md`, `persistence.md`
  - `docs/reference/` — `index.md`, `workflow-builder.md`, `workflow-instance.md`, `state-types.md`, `guards.md`, `dispatch-result.md`, `visualization.md`
  - `docs/explanation/` — `index.md`, `architecture.md`, `fixed-point-engine.md`, `design-decisions.md`
- `package.json` — added `docs:dev`, `docs:build`, `docs:preview` scripts; `vitepress ^1.6.4` in devDependencies
- `.npmrc` — added `build-scripts-allow-list=esbuild` (required by vitepress's esbuild dep)
- `PLANNING.md` — created; tracks phase-by-phase plans

**Run the site:**
```sh
pnpm docs:dev      # dev server (http://localhost:5173)
pnpm docs:build    # production build → docs/.vitepress/dist/
pnpm docs:preview  # preview the production build
```

**No source code changes.** All existing tests pass. `pnpm docs:build` exits clean.

### 2026-05-24 — Phase 2: React Web Runner SPA

- `pnpm-workspace.yaml` — created at the repo root; lists `.` and `web-runner` as workspace packages. Required because pnpm excludes `.gitignore`d files (including `dist/`) from `file:` deps; workspace symlinks bypass this.
- `package.json` — fixed `exports` map: `.mjs` → `.js` and `.cjs` (tsup with `type: "module"` emits `.js` for ESM, not `.mjs`). Also removed the stale `"module"` field.
- `web-runner/` — standalone SPA (React 19, Vite 6, Tailwind v4, @xyflow/react v12):
  - `package.json` — `"logic-workflow": "workspace:*"`; own `pnpm-lock.yaml`
  - `vite.config.ts` — `@vitejs/plugin-react` + `@tailwindcss/vite`; `optimizeDeps.include` for both library entry points
  - `tsconfig.json` — full strict mode matching parent (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `noImplicitOverride`)
  - `src/index.css` — `@import "tailwindcss"` + `@import "@xyflow/react/dist/style.css"`
  - `src/workflow/demo-workflow.ts` — engineer pre-departure checklist compiled workflow + `wireGuards`
  - `src/lib/zod-introspect.ts` — pure schema walker (`ZodObject/String/Number/Boolean/Enum/Literal/Optional/Default`) → `FieldDescriptor[]`
  - `src/App.tsx` — context provider; holds `InstanceSnapshot` in `useState`, instance in `useRef`; exposes `dispatch` + `lastError` + `availableActions`
  - `src/components/StateNode.tsx` — custom @xyflow node card; colour by status, icon by kind
  - `src/components/WorkflowGraph.tsx` — BFS layout + `JsonGraphExporter` → React Flow canvas; animated edges on active states; dashed edges for guarded transitions
  - `src/components/DynamicForm.tsx` — SDUI: action selector → `describeSchema()` → controlled inputs → dispatch
  - `src/components/HistoryPanel.tsx` — scrollable audit log from `snapshot.history`
- `.gitignore` — added `web-runner/node_modules/`, `web-runner/dist/`, `web-runner/.vite/`

**Run the web runner:**
```sh
pnpm build                     # build logic-workflow first (always required after src/ changes)
cd web-runner && pnpm dev      # → http://localhost:5174
```

`tsc --noEmit` and `vite build` both exit clean.

### 2026-05-24 — web-runner relocated to sibling of logic-workflow

`web-runner/` was nested inside `logic-workflow/` (wrong). Moved to sibling position at the git root:

```
/Users/zihung20/Desktop/workflow/
├── logic-workflow/    ← core library
└── web-runner/        ← SPA (now here)
```

Changes made:
- Moved `logic-workflow/web-runner/` → `../web-runner/` (same git repo)
- `logic-workflow/package.json` — added `"files": ["dist", "src"]` so pnpm's `file:` dep resolution includes the built output (pnpm excludes `.gitignore`d paths without this)
- `web-runner/package.json` — dep changed from `"workspace:*"` → `"file:../logic-workflow"`
- `logic-workflow/pnpm-workspace.yaml` — deleted (workspace approach no longer needed; `files` field solves the dist inclusion problem cleanly)
- `logic-workflow/.gitignore` — removed `web-runner/` entries (no longer a subdirectory)
- `web-runner/` — deleted stale `node_modules/`, `dist/`, `pnpm-lock.yaml`; ran `pnpm install` fresh

**Run the web runner (from git root):**
```sh
cd logic-workflow && pnpm build   # rebuild library after src/ changes
cd ../web-runner && pnpm install  # only needed once, or after dep changes
pnpm dev                          # → http://localhost:5173
```

`tsc --noEmit` and `vite build` both exit clean after the move.

### 2026-05-24 — EWCR demo + dagre layout + auto-fill form

- `web-runner/src/workflow/demo-workflow.ts` — replaced engineer pre-departure workflow with a
  full **40-section EWCR (Electrical Work Clearance Request)** demo (5 rows × 8 cols grid).
  Each section has 7 states: `idle → isolation-requested → isolated → clearance-issued →
  work-in-progress → work-completed → power-restored`. Two cross-section guards:
  - `neighbors-safe` (blocks `CONFIRM_ISOLATION`) — all adjacent sections must have left `idle`
  - `neighbors-clear` (blocks `RESTORE_POWER`) — no adjacent section in `clearance-issued` or `work-in-progress`
  Guards are wired via `Guard.inject()` + `instance.injectGuard()`, closing over the shared
  instances map so each section checks its live neighbours at dispatch time.

- `web-runner/package.json` — added `@dagrejs/dagre ^3.0.0` for graph layout.

- `web-runner/src/components/WorkflowGraph.tsx` — replaced hand-rolled BFS layout with
  **dagre** (`rankdir: LR`). Nodes are now properly ordered left-to-right with no crossing chaos.
  The `any` casts are isolated to the `dagreLayout` function body (dagre v3 bundles its own
  graphlib copy whose types reference an uninstalled peer package).

- `web-runner/src/components/DynamicForm.tsx` — added `autoDefault()` which pre-fills every
  field with a sensible value (name-based heuristics: `*By` → `ENG-001`, `*At` → ISO datetime,
  `reason` → "Scheduled maintenance", etc.). Fields are pre-populated whenever the selected
  action changes so users can dispatch with a single click.

- `web-runner/src/components/SectionGrid.tsx` — **new component**: 5 × 8 grid of coloured
  section tiles. Colour encodes current state. Selected section gets a white ring; its
  neighbours get a grey ring (shows which sections are interdependent for the guard logic).

- `web-runner/src/App.tsx` — rewritten to manage 40 workflow instances. Holds
  `Map<string, InstanceSnapshot>` in state (re-built after every dispatch so the grid
  re-renders). Selected-section snapshot and available actions are derived from that map.

`tsc --noEmit` and `vite build` both exit clean.

### 2026-05-24 — Type soundness, testing pyramid, and architecture cleanup

#### Discriminated union — zero eliminatable casts
- `src/types/state.ts` — added `IStepState` interface (`kind: StateKind.Step` literal) and
  `AnyState = IStepState | IForkState | IJoinState | ISubWorkflowState` union type.
- `src/types/workflow.ts` — `WorkflowDefinition.states` changed from
  `ReadonlyMap<string, IState>` to `ReadonlyMap<string, AnyState>`.
- `src/types/index.ts`, `src/index.ts` — export `IStepState` and `AnyState`.
- `src/states/step-state.ts` — now `implements IStepState` explicitly.
- `src/core/registry.ts` — `StateRegistry` now typed as `Map<string, AnyState>`.
- `src/core/builder.ts` — `addState<S extends AnyState>(...)`; removed two inline-import
  casts in `build()` (kind checks now narrow via discriminated union).
- `src/core/engine.ts` — removed `state as IJoinState` and `state as IForkState` casts.
- `src/core/instance.ts` — removed `state as ISubWorkflowState` cast and dead `void` line.
- `src/visualization/mermaid.ts` — removed 3 state casts and `status as StateStatus`.
- `src/visualization/json-graph.ts` — removed 3 state casts.
- Result: **11 eliminatable casts removed**. 6 remain at explicit storage-boundary or
  generic-accumulation sites, all with justifying comments.

#### Dead code deletion
- **Deleted** `src/types/node.ts` — unused; imported from `core/` violating layer rules.
- **Deleted** `src/core/context.ts` — only referenced by the now-deleted `node.ts`.

#### Vitest workspace — three named projects
- `vitest.workspace.ts` — defines `unit` (`src/**/*.test.ts`), `integration`
  (`tests/integration/**/*.test.ts`), and `e2e` (`tests/e2e/**/*.test.ts`) projects.
- `vitest.config.ts` — trimmed to global shared settings + coverage exclusions.
- `package.json` — added `test:unit`, `test:integration`, `test:e2e` scripts.
- `tsconfig.build.json` — added `src/**/*.test.ts` and `src/testing` to `exclude`.

#### Test co-location
- Moved guard unit tests (`tests/guards/*.test.ts` → `src/guards/*.test.ts`) and
  core unit tests (`tests/core/*.test.ts` → `src/core/*.test.ts`) next to their source.
- Moved `tests/helpers.ts` → `src/testing/helpers.ts`.

#### New unit tests (co-located in `src/`)
- `src/types/state.test.ts`, `src/states/*.test.ts` — constructors, kinds, validation.
- `src/core/registry.test.ts` — duplicate, missing-key, snapshot-independence, overwrite.
- `src/core/instance.test.ts` — snapshot round-trip, transitions, canExecute, resolveSubWorkflow.

#### New E2E invariant tests
- `tests/e2e/workflow-invariants.test.ts` — 21 tests: version counter, history accuracy,
  JSON round-trip, terminal rejection, available-transitions, SubWorkflow lifecycle.

**Test count: 74 → 141 (all passing). No API surface changes.**
**Verification:** `pnpm typecheck && pnpm test && pnpm build` all exit clean.
