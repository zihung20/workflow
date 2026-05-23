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
