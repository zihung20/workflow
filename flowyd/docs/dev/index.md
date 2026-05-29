# Developer Guide

Resources for contributors to the `flowyd` library.

| Page                            | Covers                                                     |
| ------------------------------- | ---------------------------------------------------------- |
| [Architecture](./architecture)  | Four-layer structure, one-way import rule, file map        |
| [Fixed-Point Engine](./engine)  | How fork/join resolve in a single dispatch tick            |
| [Design Decisions](./decisions) | Why Config-First, why Zod, why pure engine, why no storage |
| [Contributing](./contributing)  | Setup, pipeline, code style, testing                       |

## Quick start for contributors

```sh
# 1. Install and build the library
cd flowyd
pnpm install
pnpm build

# 2. Run the full pipeline before opening a PR
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

All four commands must exit clean. See [Contributing](./contributing) for details.
