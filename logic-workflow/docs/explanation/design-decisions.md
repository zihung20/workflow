# Design decisions

This article explains the reasoning behind the library's most distinctive choices. Each decision reflects a constraint that was considered and consciously accepted.


## Zod as the single source of truth for types

Every payload type in the library is derived from a Zod schema via `z.infer<typeof MySchema>`. Writing a TypeScript `interface` and then mirroring it in a Zod schema duplicates the contract — the two inevitably drift.

Zod schemas serve triple duty:
1. **TypeScript type** — `z.infer<>` produces the type for free
2. **Runtime validator** — called by the engine before every `dispatch`
3. **Schema introspection** — a future JSON Schema or OpenAPI exporter can derive its output from the same Zod object

This is why `defineAction(name, schema)` accepts a `ZodSchema` directly rather than a plain TypeScript type.


## No silent failures — everything throws

The library has a rule: functions that can fail must throw. They do not return `null`, `undefined`, or `false` to signal an error.

The motivation is observability. A `null` return from `getNode(id)` puts the burden on every caller to check and handle it. One caller who forgets creates a silent failure that surfaces as a confusing downstream error — often in production. A thrown `Error` with a precise message surfaces immediately at the call site.

The only exception to this rule is `dispatch`, which returns `TransitionBlocked` for domain failures (`guard-failed`, `terminal-state`, etc.) rather than throwing. This is intentional: those are valid, expected outcomes that the caller's business logic must handle. They are not programming errors. Contrast with payload validation failure, which throws `ZodError` — that is always a bug in the caller.


## Purely functional persistence

The engine never touches storage. `getSnapshot()` returns a plain JSON object. `restoreInstance(snapshot)` reconstructs exact state from it. The database, the ORM, the serialization format, and the concurrency strategy are entirely the application's concern.

This decoupling has several benefits:

- **Testability** — unit tests can `createInstance`, dispatch actions, and inspect `getSnapshot()` without any database setup
- **Portability** — the same snapshot can be written to Postgres, Redis, an S3 object, or a flat file with no library changes
- **Auditability** — the snapshot is human-readable JSON; you can inspect it directly in any database client
- **Version conflicts** — `snapshot.version` gives you a free optimistic-concurrency token; no additional infrastructure required


## The engine has no I/O

`WorkflowEngine` is a pure function: given a snapshot and an action, it returns a new snapshot. It does not call `setTimeout`, `fetch`, or any other I/O primitive. Guards that need I/O (database lookups, auth checks) are injected at runtime via `injectGuard` — the engine calls them as opaque `() => Promise<boolean>` callbacks.

This makes the engine deterministic and synchronously testable: inject a guard that resolves to a fixed value and run the engine. No mocking, no waiting.


## Guard injections are not persisted

Guard implementations are runtime behaviour — they are functions, not data. Serializing functions into a snapshot is not feasible (and would couple the snapshot format to the implementation language). The contract is therefore: after every `restoreInstance`, re-inject any named guards before dispatching.

This is an explicit, visible requirement rather than a hidden footgun. The error thrown when a missing guard is evaluated makes the gap obvious immediately:

```
Error: Guard "isManager" has not been injected. Call instance.injectGuard("isManager", fn).
```


## Visualization is a separate entry point

The `MermaidExporter` and `JsonGraphExporter` live in `logic-workflow/visualization` — a separate package entry point. This means:

1. Bundlers can tree-shake the visualization code from applications that do not use it
2. The core engine (`core/`, `states/`, `guards/`, `types/`) is guaranteed to have zero knowledge of the visualization layer — importing `visualization/` from `core/` would be a build violation, not just a style violation
3. Future exporters (e.g., SVG, BPMN) can be added without touching any core file

The physical separation enforces the architectural rule at the toolchain level, not just by convention.


## WorkflowBuilder: Config-First state declaration

All state IDs are passed to the constructor as `states: [...] as const`. TypeScript infers the `TStates` union at the point of instantiation, so `addStep`, `addFork`, `addJoin`, `addWait`, `setInitial`, `setTerminal`, and `addTransition` are all constrained to that fixed set of names for the entire chain.

`addFork` and `addJoin` go further: their `targets` and `requires` arrays are also typed as `TStates[]`, giving IDE autocomplete for prerequisite state names without any manual type annotations.

`defineAction` still returns `WorkflowBuilder<TActions & Record<K, T>, TStates>` — a new generic specialization — because `TActions` must accumulate across calls. At runtime the same object is returned (via `as unknown as …` casts); only the TypeScript type changes. This design gives compile-time safety on `addTransition`, `dispatch`, and `canExecute`, which are constrained to registered action names and state IDs, catching typos at compile time rather than at `build()` time.
