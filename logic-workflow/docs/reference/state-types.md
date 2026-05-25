# State Types

States are the nodes of the workflow graph. Each state has a unique `id`, a `kind` that controls engine behaviour on entry, and a `label` used in visualization.

```ts
import { StepState, ForkState, JoinState, WaitState } from 'logic-workflow';
```


## State statuses

Every state moves through a fixed set of statuses as the workflow progresses:

| Status | Meaning |
|--------|---------|
| `idle` | Not yet entered |
| `active` | Currently active — awaiting a dispatch |
| `waiting` | `WaitState` only — paused until `resolveWait` is called |
| `completed` | Exited; will not become active again |


## StepState

The fundamental building block. Becomes `active` on entry and waits for a dispatch to advance.

```ts
new StepState(id: string, options?: { label?: string })
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `id` | `string` | — | Unique identifier. Must be non-empty. |
| `options.label` | `string` | `id` | Human-readable label for visualization. |

**Throws** `Error` if `id` is empty or whitespace.

```ts
new StepState('draft')
new StepState('pending-approval', { label: 'Pending Approval' })
```


## ForkState

A transient splitter. When entered, it completes immediately and activates all target states in the same engine tick. The engine never leaves a `ForkState` in `active` status.

```ts
new ForkState(id: string, options: { label?: string; targets: string[] })
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | `string` | yes | Unique identifier. |
| `options.targets` | `string[]` | yes | IDs of states to activate simultaneously on entry. |
| `options.label` | `string` | no | Visualization label. |

**Throws** `Error` if `targets` is empty.

```ts
new ForkState('parallel-reviews', {
  targets: ['legal-review', 'finance-review'],
})
```


## JoinState

A synchronisation barrier. Monitors prerequisite states and activates automatically once the threshold is met — no explicit dispatch is needed to cross the barrier.

```ts
new JoinState(id: string, options: {
  label?:    string;
  requires:  string[];
  mode?:     'all' | 'any' | number;
})
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `id` | `string` | — | Unique identifier. |
| `options.requires` | `string[]` | — | IDs of states that must complete before this join fires. |
| `options.mode` | `'all' \| 'any' \| number` | `'all'` | Completion threshold (see below). |
| `options.label` | `string` | `id` | Visualization label. |

**Throws** `Error` if `requires` is empty.

**`mode` values:**

| Value | Meaning |
|-------|---------|
| `'all'` | All states in `requires` must complete |
| `'any'` | At least one state in `requires` must complete |
| `number` | At least N states in `requires` must complete (quorum) |

```ts
new JoinState('reviews-complete', {
  requires: ['legal', 'finance', 'compliance'],
  mode: 2,   // 2 of 3 is enough
})
```


## WaitState

Pauses the parent workflow at `waiting` status until the service layer calls `resolveWait`. The engine has no I/O coupling — orchestration is entirely the service layer's responsibility.

```ts
new WaitState(id: string, options: {
  label?:       string;
  externalName: string;
})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | `string` | yes | Unique identifier in the parent workflow. |
| `options.externalName` | `string` | yes | Name of the external process. Used for documentation and visualization; the engine never resolves it. |
| `options.label` | `string` | no | Visualization label. |

```ts
new WaitState('vendor-kyc', {
  externalName: 'kyc-workflow',
})
```

See [Pause for an external process](/how-to/wait-state) for the full service-layer pattern.
