# Contributing

## Prerequisites

| Tool | Version |
|------|---------|
| Node.js | ≥ 20 |
| pnpm | ≥ 9 |

Install pnpm if you don't have it:

```sh
npm install -g pnpm
```

## Project Structure

```
workflow/
├── logic-workflow/   # Core TypeScript library
│   ├── src/          # Source code
│   ├── tests/        # Unit tests (Vitest)
│   ├── examples/     # Runnable usage examples
│   └── docs/         # VitePress documentation site
└── web-runner/       # React SPA demo (Vite + React Flow)
```

## Setup

```sh
# 1. Install library deps and build
cd logic-workflow
pnpm install
pnpm build

# 2. Install web-runner deps (uses the built library above)
cd ../web-runner
pnpm install
```

## Development Workflow

### Library (`logic-workflow/`)

```sh
pnpm dev          # watch mode — rebuilds on save
pnpm typecheck    # tsc --noEmit
pnpm lint         # ESLint
pnpm test         # Vitest (single run)
pnpm test:watch   # Vitest (watch mode)
pnpm build        # production build → dist/
```

### Web Runner (`web-runner/`)

> Rebuild the library first whenever you change `logic-workflow/src/`.

```sh
# In logic-workflow/
pnpm build

# In web-runner/
pnpm dev      # → http://localhost:5173
pnpm build    # production build
```

### Documentation (`logic-workflow/docs/`)

```sh
pnpm docs:dev      # dev server → http://localhost:5173
pnpm docs:build    # production build
pnpm docs:preview  # preview the production build
```

## Code Conventions

This project applies strict rules documented in [`logic-workflow/CLAUDE.md`](logic-workflow/CLAUDE.md). The key points:

### Package Manager
Use **pnpm only**. Never commit `package-lock.json` or `yarn.lock`.

### TypeScript
- Strict mode is non-negotiable (`strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `noImplicitOverride`).
- No `any`. Use `unknown` and narrow explicitly.
- No non-null assertions (`!`) without a comment explaining why the value is provably non-null.

### Zod Schemas
Define the Zod schema first; derive the TypeScript type from it with `z.infer<>`. Never write a separate `interface` alongside its schema.

### Layer Boundaries
Dependencies flow one way: `visualization → core → nodes → types/schemas`. No layer may import from a layer above it.

### Error Handling
- Functions that can fail must throw a typed error — never return `null` or `undefined` to signal failure.
- `catch` blocks must re-throw or wrap-and-rethrow. Silent catches are prohibited.

### Comments
- Write TSDoc on every exported symbol.
- Inside function bodies, only comment the **why** — never the what.

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short description>

[optional body]
```

Common types:

| Type | When to use |
|------|-------------|
| `feat` | New feature or capability |
| `fix` | Bug fix |
| `refactor` | Code restructure with no behaviour change |
| `test` | Adding or updating tests |
| `docs` | Documentation only |
| `chore` | Tooling, config, dependency updates |

Examples:

```
feat(core): add timeout support to WorkflowEngine
fix(builder): throw on duplicate state ID instead of silently overwriting
docs(guards): add guard injection example to how-to guide
chore: upgrade vitest to 2.x
```

## Pull Requests

1. Branch off `main`.
2. Keep changes focused — one logical change per PR.
3. Ensure CI passes: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
4. Update `CLAUDE.md` Session History with a dated entry describing what changed and why.
5. Write a clear PR description: what problem does this solve, and how?
