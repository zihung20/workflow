# Core Concepts

A workflow is a directed graph of **states** connected by **transitions**. The **engine** advances the graph when you dispatch an **action**. The result is a **snapshot** — a plain JSON object you can store anywhere.

## States

Every node in the graph is a state. There are four kinds.

### StepState — the basic building block

A `StepState` is `active` when entered and waits for a dispatch to advance it. Most workflow steps are `StepState`.

```
draft ──SUBMIT──▶ review ──APPROVE──▶ approved
```

```ts
.addStep('draft')
.addStep('review')
.addStep('approved')
```

**Use when:** the workflow is paused at this node waiting for a human or system action.

### ForkState — fan out to parallel branches

A `ForkState` is a routing node. The moment it is entered, it immediately activates all its `targets` and marks itself `completed`. It is never left in the `active` status — it is transient by design.

```
                 ┌──▶ legal-review
briefed ──▶ fork ┤
                 └──▶ finance-review
```

```ts
.addFork('fork', { targets: ['legal-review', 'finance-review'] })
```

**Use when:** multiple steps must run concurrently and independently.

### JoinState — synchronise parallel branches

A `JoinState` activates automatically when its `requires` threshold is satisfied. No extra dispatch is needed.

```
legal-review  ──┐
                ├──▶ join (mode: 'all') ──FINALIZE──▶ approved
finance-review ──┘
```

```ts
.addJoin('join', {
  requires: ['legal-review', 'finance-review'],
  mode: 'all',   // 'any' | 'all' | number
})
```

| Mode       | Activates when                                  |
| ---------- | ----------------------------------------------- |
| `'all'`    | Every state in `requires` is `completed`        |
| `'any'`    | At least one state in `requires` is `completed` |
| `number N` | At least N states in `requires` are `completed` |

**Use when:** you need to re-synchronise after a `ForkState`.

### WaitState — pause for an external signal

A `WaitState` enters `waiting` status (not `active`) when reached. The workflow is paused. Your service layer drives the external process, then calls `inst.resolveWait(stateId)` to unblock it.

```
order-placed ──SUBMIT──▶ payment-processing ⤴ ──PAYMENT_OK──▶ confirmed
                         (waiting for Stripe webhook)
```

```ts
.addWait('payment-processing', { externalName: 'stripe-payment' })
```

**Use when:** the workflow must wait for an external system — a webhook, a background job, a human approval in another system — before it can continue.

## Transitions

A transition is a directed edge from one state to another, fired when a specific action is dispatched.

```ts
.addTransition({ from: 'draft', to: 'review', on: 'SUBMIT' })
.addTransition({ from: 'review', to: 'approved', on: 'APPROVE', guard: Guard.inject('isManager') })
.addTransition({ from: 'review', to: 'rejected', on: 'REJECT' })
```

Every transition has:

- `from` — the source state (must be `active` for the transition to fire)
- `to` — the destination state
- `on` — the action name that triggers it
- `guard` _(optional)_ — a predicate that must return `true` for the transition to fire

## Actions

An action is a named event with a typed payload. You define actions with `defineAction` before wiring any transitions.

```ts
.defineAction('SUBMIT', z.object({ submitterId: z.string() }))
.defineAction('APPROVE', z.object({ approverId: z.string(), reason: z.string() }))
```

Zod schema → TypeScript type automatically. You never write the type separately.

## Guards

A guard is an async predicate on a transition. If it returns `false`, the transition does not fire and the instance state is unchanged.

```ts
// Inline guard — pure function, no external deps
.addTransition({
  from: 'review',
  to: 'approved',
  on: 'APPROVE',
  guard: (ctx) => ctx.payload.approverId !== '',
})

// Named guard — implementation injected at runtime
.addTransition({
  from: 'review',
  to: 'approved',
  on: 'APPROVE',
  guard: Guard.inject('isManager'),
})
```

Named guards keep the workflow definition free of I/O. You supply the implementation when you create the instance:

```ts
inst.injectGuard('isManager', async (ctx) => {
  return myAuthService.hasRole(ctx.payload.approverId, 'manager');
});
```

Guards are **not persisted** in snapshots — re-inject them after every `restoreInstance`.

## Snapshots

A snapshot is a plain JSON object that captures the complete state of a running workflow instance.

```ts
interface InstanceSnapshot {
  instanceId: string;
  workflowName: string;
  version: number; // increments on every successful dispatch or resolveWait
  stateStatuses: Record<string, 'idle' | 'active' | 'waiting' | 'completed'>;
  isTerminal: boolean;
  history: HistoryEntry[]; // append-only audit log
  createdAt: string; // ISO 8601
  updatedAt: string;
}
```

The snapshot is the **entire state** — there is no hidden in-memory state. Save it after every successful dispatch; restore it with `restoreInstance` to resume exactly where you left off.

```ts
// Save
const snap = inst.getSnapshot();
await db.save(snap);

// Restore
const snap = await db.load(instanceId);
const inst = workflow.restoreInstance(snap);
inst.injectGuard('isManager', myGuardFn); // re-inject guards
```

## State statuses

Every state moves through a fixed progression:

| Status      | Meaning                                                 |
| ----------- | ------------------------------------------------------- |
| `idle`      | Not yet entered                                         |
| `active`    | Currently active — awaiting a dispatch                  |
| `waiting`   | `WaitState` only — paused until `resolveWait` is called |
| `completed` | Exited; will not become active again                    |

States only move forward. The engine never reverses a status.
