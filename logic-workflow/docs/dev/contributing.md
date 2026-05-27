# Contributing

## Prerequisites

| Tool | Version |
|---|---|
| Node.js | ≥ 20 |
| pnpm | ≥ 9 |

Install pnpm if you don't have it:

```sh
npm install -g pnpm
```

## Repository structure

```
workflow/
├── logic-workflow/   # Core TypeScript library (this repo)
│   ├── src/          # Source code
│   ├── tests/        # Integration and e2e tests (Vitest)
│   ├── examples/     # Runnable usage examples
│   └── docs/         # VitePress documentation site
└── web-runner/       # React SPA demo (Vite + React Flow)
```

## Setup

```sh
cd logic-workflow
pnpm install
pnpm build
```

To run the web runner after building the library:

```sh
cd ../web-runner
pnpm install
pnpm dev   # → http://localhost:5173
```

## Development commands

```sh
pnpm dev            # watch mode — rebuilds on save
pnpm format         # Prettier — format all files
pnpm format:check   # Prettier — check without writing
pnpm typecheck      # tsc --noEmit
pnpm lint           # ESLint
pnpm lint:fix       # ESLint with auto-fix
pnpm test           # Vitest (all three projects: unit, integration, e2e)
pnpm test:unit
pnpm test:integration
pnpm test:e2e
pnpm test:watch     # Vitest watch mode
pnpm build          # production build → dist/
pnpm docs:dev       # VitePress dev server
pnpm docs:build     # VitePress production build
```

## Before opening a PR

Run the full gate — all four must exit clean:

```sh
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

## Code style

### Formatting

Prettier with `printWidth: 100`, `singleQuote: true`, `trailingComma: 'all'`. Run `pnpm format` before committing.

### TypeScript

- No `any`. Use `unknown` and narrow explicitly.
- No non-null assertions (`!`) without a comment proving the value is non-null.
- No `as` casts except at layer boundaries after a `kind` discriminant check — every cast needs a comment.
- Use `state.kind === StateKind.Fork` to narrow `AnyState`, not `state as IForkState`.

### Zod

Every payload type is `z.infer<typeof MySchema>`. Never write a parallel `interface` alongside a Zod schema.

### Conditionals

- Use curly braces on all `if`/`else` bodies — no exceptions. (`"curly": "error"` in ESLint config.)
- Prefer early returns over nested `if-else` chains.
- Use `switch` over long `if-else` chains on a discriminated value.

### Error handling

Functions that can fail throw a typed error. No silent `catch` blocks:

```ts
// Correct
try { result = await doWork(); }
catch (err) { throw new WorkflowExecutionError('failed', { cause: err }); }

// Never
try { result = await doWork(); }
catch { result = defaultValue; }
```

### Comments

Write a comment only when the *why* would surprise an informed reader. Never explain what the code does — rename the identifier instead.

### TSDoc

Every exported symbol needs a TSDoc block with a one-sentence description, `@param`, `@returns`, and `@throws`.

## Test structure

| Project | Glob | Purpose |
|---|---|---|
| `unit` | `src/**/*.test.ts` | Co-located unit tests |
| `integration` | `tests/integration/**/*.test.ts` | Multi-component flows |
| `e2e` | `tests/e2e/**/*.test.ts` | Full workflow invariants |

`tests/helpers.ts` — shared `makeCtx` fixture used by guard unit tests.

## Layer rules

Imports flow downward only:

```
visualization/
    ↓
core/
    ↓
states/   guards/
    ↓
types/
```

`core/` must not import from `visualization/`. `states/` must not import from `core/`. `types/` must not import from any other layer. Treat a violation as a build error even when the compiler does not catch it.

## After every code change

Run `pnpm lint && pnpm typecheck && pnpm test && pnpm build`. Append a version entry to Section 4 of `CLAUDE.md` and update `README.md`.
