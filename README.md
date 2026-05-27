# flowyd

Strongly-typed SOP state machines for TypeScript.

This repository contains two packages that work together:

---

## `flowyd/` — the core library

A TypeScript library for building typed, auditable workflow state machines. Install it in your project to define and execute workflows in code.

```sh
pnpm add flowyd zod
```

The compiler catches every typo in a state ID, every wrong action name, and every mismatched payload shape before your code runs.

- [Library README](./flowyd/README.md) — install, quick start, API overview
- [Full documentation](https://your-docs-site.com/guide/)

---

## `web-runner/` — the browser UI

A React SPA (Vite + Tailwind + React Flow) that visualises and drives workflows in the browser. Not published to npm — used for local development and demonstration.

```sh
# Build the library first
cd flowyd && pnpm build

# Start the web runner
cd ../web-runner && pnpm dev   # → http://localhost:5173
```

---

## Development

```sh
# Install and build everything
cd flowyd && pnpm install && pnpm build
cd ../web-runner  && pnpm install
```

See [Contributing](./flowyd/docs/dev/contributing.md) for the full development guide.
