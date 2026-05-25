# Architecture

`logic-workflow` is organized into four strict layers. **Imports flow in one direction only — downward.** No layer may import from a layer above it.

```
visualization/
    ↓ (may import from)
core/
    ↓
states/   guards/
    ↓
types/
```


## The four layers

### `types/`

Pure TypeScript interfaces, enums, and discriminated unions. Contains zero logic and imports nothing from the rest of the codebase. Everything else derives its type contracts from this layer.

Key exports: `IState`, `IForkState`, `IJoinState`, `IWaitState`, `IGuard`, `GuardContext`, `TransitionDefinition`, `InstanceSnapshot`, `DispatchResult`, `WorkflowDefinition`, `StateKind`, `StateStatus`, `JoinMode`.

### `states/` and `guards/`

Concrete implementations of `IState` and `IGuard`. Import only from `types/`. Neither layer is aware of the engine, the builder, or each other.

- **`states/`** — `BaseState`, `StepState`, `ForkState`, `JoinState`, `WaitState`
- **`guards/`** — `FnGuard`, `InjectedGuard`, `AndGuard`, `OrGuard`, `NotGuard`, `StateCompletedGuard`, `StateActiveGuard`, `AlwaysGuard`, `NeverGuard`, `Guard` (factory namespace)

### `core/`

The engine, builder, instance, and state/guard registries. Imports from `types/`, `states/`, and `guards/`. Five files:

| File | Responsibility |
|------|---------------|
| `builder.ts` | Fluent `WorkflowBuilder` — accumulates the graph definition |
| `workflow.ts` | Immutable `Workflow` factory — `createInstance`, `restoreInstance`, `getDefinition` |
| `instance.ts` | Mutable `WorkflowInstance` — holds snapshot, exposes `dispatch`, `canExecute`, etc. |
| `engine.ts` | Pure, stateless `WorkflowEngine` — computes the next snapshot from a current snapshot + action |
| `registry.ts` | `StateRegistry` and `GuardRegistry` — lookup maps with explicit error messages |

### `visualization/`

Stateless exporters. Import only from `types/` (they need `WorkflowDefinition` and `InstanceSnapshot` shapes — nothing else). The `core/` layer has **zero knowledge** that this layer exists.

This is enforced by keeping visualization as a separate package entry point (`logic-workflow/visualization`). Tree-shakers strip it when unused.


## Why one-directional imports?

Bidirectional imports create invisible coupling. If `core/engine.ts` imported `MermaidExporter` to generate debug output, a visualization bug could corrupt the engine, and a visualization change would require re-testing the engine. The direction constraint eliminates this class of problem.

The rule is also a forcing function for interface design. If you find yourself wanting to import "upward", it is a signal that the abstraction boundary is wrong — the shared concept should be extracted into `types/`, not shared via a cross-layer import.


## The `ExecutionContext` exception

`nodes/` (if present in future extensions) may import `ExecutionContext` from `core/`. `ExecutionContext` is a pure data carrier — it holds runtime state but contains no methods that reach back into the engine. It is the only permitted upward import and must remain a data-only type.


## File map

```
src/
├── types/
│   ├── state.ts         ← StateKind, StateStatus, IState, IForkState, IJoinState, IWaitState, JoinMode
│   ├── guard.ts         ← IGuard, GuardFn, GuardContext
│   ├── transition.ts    ← TransitionDefinition
│   ├── instance.ts      ← ReadonlyInstanceState, InstanceSnapshot, DispatchResult, HistoryEntry
│   └── workflow.ts      ← WorkflowDefinition, ActionPayloadMap
│
├── states/
│   ├── base.ts
│   ├── step-state.ts
│   ├── fork-state.ts
│   ├── join-state.ts
│   └── wait-state.ts
│
├── guards/
│   ├── primitives.ts    ← AlwaysGuard, NeverGuard, FnGuard
│   ├── inject-guard.ts  ← InjectedGuard
│   ├── and-guard.ts
│   ├── or-guard.ts
│   ├── not-guard.ts
│   ├── state-guard.ts   ← StateCompletedGuard, StateActiveGuard
│   └── factory.ts       ← Guard namespace
│
├── core/
│   ├── builder.ts
│   ├── workflow.ts
│   ├── instance.ts
│   ├── engine.ts
│   └── registry.ts
│
└── visualization/
    ├── mermaid.ts
    └── json-graph.ts
```
