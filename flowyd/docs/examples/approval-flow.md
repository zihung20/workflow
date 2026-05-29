# Purchase Order Approval

A four-state linear flow with a guarded approval step. This is the canonical introductory example.

**Features shown:** typed Zod payloads, `Guard.inject`, blocked dispatch, `getSnapshot` / `restoreInstance`.

## Workflow diagram

```
draft ──SUBMIT──▶ pending-approval ──APPROVE (guard: isManager)──▶ approved ✓
                                   └──REJECT──────────────────────▶ rejected ✓
```

## Full code

```ts
import { z } from 'zod';
import { createWorkflow, Guard } from 'flowyd';

// ── Action schemas ──────────────────────────────────────────────────────────

const SubmitSchema = z.object({ submitterId: z.string() });
const ApproveSchema = z.object({ approverId: z.string(), reason: z.string() });
const RejectSchema = z.object({ reason: z.string() });

// ── Workflow definition ─────────────────────────────────────────────────────
//
// TStates accumulates with each addStep call; every subsequent call
// is constrained to the growing set — typos are compile errors.

const purchaseOrder = createWorkflow({ name: 'purchase-order' })
  .defineAction('SUBMIT', SubmitSchema)
  .defineAction('APPROVE', ApproveSchema)
  .defineAction('REJECT', RejectSchema)

  .addStep('draft', { label: 'Draft' })
  .addStep('pending-approval', { label: 'Pending Approval' })
  .addStep('approved', { label: 'Approved' })
  .addStep('rejected', { label: 'Rejected' })

  .setInitial('draft')
  .setTerminal(['approved', 'rejected'])

  .addTransition({ from: 'draft', to: 'pending-approval', on: 'SUBMIT' })
  .addTransition({
    from: 'pending-approval',
    to: 'approved',
    on: 'APPROVE',
    guard: Guard.inject('isManager'), // implementation supplied at runtime
  })
  .addTransition({ from: 'pending-approval', to: 'rejected', on: 'REJECT' })

  .build();

// ── Runtime ─────────────────────────────────────────────────────────────────

async function run() {
  const inst = purchaseOrder.createInstance('po-001');

  // Inject the guard before dispatching any APPROVE action.
  // In production this calls your auth service.
  inst.injectGuard('isManager', async (ctx) => {
    return ctx.payload.approverId === 'mgr-1';
  });

  // Step 1 — submit the draft
  const r1 = await inst.dispatch('SUBMIT', { submitterId: 'alice' });
  console.log(r1.success); // true
  console.log(inst.getCurrentStates()); // ['pending-approval']

  // Step 2 — a non-manager tries to approve (guard blocks)
  const r2 = await inst.dispatch('APPROVE', { approverId: 'bob', reason: 'LGTM' });
  console.log(r2.success); // false
  console.log(!r2.success && r2.reason); // 'guard-failed'
  console.log(inst.getCurrentStates()); // ['pending-approval'] — unchanged

  // Step 3 — the manager approves
  const r3 = await inst.dispatch('APPROVE', { approverId: 'mgr-1', reason: 'LGTM' });
  console.log(r3.success); // true
  console.log(inst.getCurrentStates()); // ['approved']
  console.log(inst.isTerminal()); // true

  // ── Persist and restore ──────────────────────────────────────────────────

  // Save after every successful dispatch
  const snapshot = inst.getSnapshot();
  // await db.workflowSnapshots.upsert({ where: { id: 'po-001' }, data: snapshot });

  // Later — restore and continue (or verify terminal status)
  const restored = purchaseOrder.restoreInstance(snapshot);
  // Guards are not stored — re-inject them
  restored.injectGuard('isManager', async (ctx) => ctx.payload.approverId === 'mgr-1');

  console.log(restored.getCurrentStates()); // ['approved']
  console.log(restored.isTerminal()); // true
  console.log(restored.getSnapshot().history.map((h) => h.action));
  // ['SUBMIT', 'APPROVE']
}

run().catch(console.error);
```

## What to notice

**Blocked dispatch is a no-op.** When `r2.success` is `false`, the instance is completely unchanged. The version counter does not increment. You do not need to save.

**`Guard.inject` decouples definition from runtime.** The workflow definition has no knowledge of `myAuthService`. You wire the implementation when you create the instance, which means you can inject a mock in tests and a real database call in production.

**`restoreInstance` validates the workflow name.** If you accidentally pass a snapshot from a different workflow, it throws immediately rather than silently applying the wrong state.

## Type safety demonstration

Try these and watch the compiler catch them before you run anything:

```ts
// Wrong state ID
purchaseOrder.addStep('pendng-approval'); // TS error

// Wrong action name at dispatch
await inst.dispatch('APPROV', { approverId: 'x', reason: 'y' }); // TS error

// Wrong payload shape
await inst.dispatch('APPROVE', { approver: 'mgr-1' }); // TS error — 'approver' not in schema
```
