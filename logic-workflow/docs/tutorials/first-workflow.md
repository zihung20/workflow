# Build your first workflow

In this tutorial you will build a **purchase-order approval workflow** from the ground up. By the end you will have:

- Defined actions with typed Zod schemas
- Wired states and guarded transitions
- Created an instance, dispatched events, and read the result
- Saved and restored the workflow state

This tutorial assumes you know TypeScript. It does not assume any prior knowledge of state machines.


## 1. Install

```sh
pnpm add logic-workflow zod
```

`zod` is a required peer dependency — every action payload type is derived from a Zod schema.


## 2. Sketch the workflow

Before writing code, draw what you want on a napkin:

```
draft ──SUBMIT──▶ pending-approval ──APPROVE (guard: isManager)──▶ approved
                                   └──REJECT──────────────────────▶ rejected
```

There are four states and three actions. `APPROVE` is guarded — only a manager may approve. `REJECT` has no guard; any actor may reject.


## 3. Define your actions

Open a new file, `purchase-order.ts`:

```ts
import { z } from 'zod';
import { WorkflowBuilder, Guard } from 'logic-workflow';

const purchaseOrder = new WorkflowBuilder({
  name: 'purchase-order',
  states: ['draft', 'pending-approval', 'approved', 'rejected'] as const,
})
  .defineAction('SUBMIT',  z.object({ submitterId: z.string() }))
  .defineAction('APPROVE', z.object({ approverId: z.string(), reason: z.string() }))
  .defineAction('REJECT',  z.object({ reason: z.string() }))
```

`defineAction` binds a name to a Zod schema. The TypeScript type of the payload is inferred from the schema — you never write it twice.

::: tip Why Zod?
Zod schemas are the single source of truth for both the TypeScript type and the runtime validator. Writing a separate `interface` and then mirroring it in a schema duplicates the contract and creates drift.
:::


## 4. Add states

Continue chaining:

```ts
  .addStep('draft',            { label: 'Draft' })
  .addStep('pending-approval', { label: 'Pending Approval' })
  .addStep('approved',         { label: 'Approved' })
  .addStep('rejected',         { label: 'Rejected' })
```

`addStep` registers a `StepState` — the basic building block. It becomes `active` when entered and waits for a dispatch to advance. Because all four IDs were declared in the constructor, the compiler will reject any typo at this point.


## 5. Wire transitions

```ts
  .setInitial('draft')
  .setTerminal(['approved', 'rejected'])
  .addTransition({ from: 'draft',            to: 'pending-approval', on: 'SUBMIT' })
  .addTransition({ from: 'pending-approval', to: 'approved',
                   on: 'APPROVE', guard: Guard.inject('isManager') })
  .addTransition({ from: 'pending-approval', to: 'rejected', on: 'REJECT' })
  .build();
```

`Guard.inject('isManager')` declares a **named guard placeholder**. You will provide the implementation at runtime, after creating an instance. This keeps your workflow definition free of I/O.


## 6. Create an instance and inject the guard

```ts
const inst = purchaseOrder.createInstance('po-001');

// Inject the guard before dispatching any APPROVE action.
inst.injectGuard('isManager', async (ctx) => {
  const payload = ctx.payload as { approverId: string };
  // Replace with a real database/auth check in production.
  return payload.approverId === 'mgr-1';
});
```

Guard injections are not persisted in the snapshot, so re-inject after every `restoreInstance` call.


## 7. Drive the workflow forward

```ts
// Step 1 — submit the draft
const r1 = await inst.dispatch('SUBMIT', { submitterId: 'alice' });
console.log(r1.success);                     // true
console.log(inst.getCurrentStates());        // ['pending-approval']

// Step 2 — a non-manager tries to approve (guard blocks)
const r2 = await inst.dispatch('APPROVE', { approverId: 'bob', reason: 'LGTM' });
console.log(r2.success);                     // false
console.log((r2 as any).reason);             // 'guard-failed'
console.log(inst.getCurrentStates());        // ['pending-approval'] — unchanged

// Step 3 — the manager approves
const r3 = await inst.dispatch('APPROVE', { approverId: 'mgr-1', reason: 'LGTM' });
console.log(r3.success);                     // true
console.log(inst.getCurrentStates());        // ['approved']
console.log(inst.isTerminal());              // true
```

When `success` is `false`, **the instance state is unchanged**. The failed dispatch is a no-op.


## 8. Persist the result

After every successful dispatch, call `getSnapshot()` and write to your database:

```ts
if (r3.success) {
  const snapshot = inst.getSnapshot();
  await db.workflowSnapshots.upsert({
    where: { id: 'po-001' },
    create: { id: 'po-001', data: snapshot },
    update: { data: snapshot },
  });
}
```

To resume later:

```ts
const row = await db.workflowSnapshots.findUnique({ where: { id: 'po-001' } });
const restored = purchaseOrder.restoreInstance(row.data);

// Re-inject guards — they are not stored in the snapshot.
restored.injectGuard('isManager', myGuardFn);
```


## What you built

| Concept | How you used it |
|---------|----------------|
| `WorkflowBuilder` | Config-First builder: declare states upfront, then `defineAction → addStep → setInitial → setTerminal → addTransition → build` |
| `StepState` | Four states: `draft`, `pending-approval`, `approved`, `rejected` |
| `Guard.inject` | Named guard resolved at runtime from `injectGuard()` |
| `dispatch` | Validates payload, evaluates guard, fires transition atomically |
| `getSnapshot` / `restoreInstance` | Purely functional persistence — you own the storage |


## Next steps

- [Run steps in parallel](/how-to/parallel-branches) — use `ForkState` and `JoinState`
- [Pause for an external process](/how-to/wait-state) — pause until an external signal arrives
- [Guard composition](/how-to/guards) — `Guard.and`, `Guard.or`, `Guard.not`
