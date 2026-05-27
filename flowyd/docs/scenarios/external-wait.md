# Wait for an external signal

`WaitState` pauses a workflow until an external process — a webhook, a background job, a human action in another system — signals completion.

## How it works

1. The workflow transitions into a `WaitState`. The state's status becomes `waiting` (not `active`).
2. Your service layer creates and drives the external process independently.
3. When the external process finishes, call `inst.resolveWait(stateId)`.
4. Status becomes `active` — normal transitions can now advance past it.

The engine has **no polling, no callbacks, no I/O**. The `externalName` string is for documentation only.

## Code

```ts
import { z } from 'zod';
import { createWorkflow } from 'flowyd';

const vendorOnboarding = createWorkflow({
  name: 'vendor-onboarding',
  states: ['draft', 'kyc-check', 'approved', 'rejected'],
})
  .defineAction('SUBMIT', z.object({ vendorId: z.string() }))
  .defineAction('KYC_PASSED', z.object({}))
  .defineAction('KYC_FAILED', z.object({ reason: z.string() }))

  .addStep('draft')
  .addWait('kyc-check', { externalName: 'vendor-kyc' })
  .addStep('approved')
  .addStep('rejected')

  .setInitial('draft')
  .setTerminal(['approved', 'rejected'])

  .addTransition({ from: 'draft', to: 'kyc-check', on: 'SUBMIT' })
  .addTransition({ from: 'kyc-check', to: 'approved', on: 'KYC_PASSED' })
  .addTransition({ from: 'kyc-check', to: 'rejected', on: 'KYC_FAILED' })

  .build();
```

## Service-layer pattern

Call `resolveWait` from your webhook handler, then dispatch the outcome action:

```ts
// Called when the KYC provider posts a webhook
async function onKycWebhook(parentInstanceId: string, passed: boolean) {
  // 1. Load the persisted snapshot
  const row = await db.workflowSnapshots.findUnique({ where: { id: parentInstanceId } });
  const inst = vendorOnboarding.restoreInstance(row.data);

  // 2. Unblock the WaitState — promotes 'waiting' → 'active'
  inst.resolveWait('kyc-check');

  // 3. Dispatch the outcome
  const action = passed ? 'KYC_PASSED' : 'KYC_FAILED';
  const payload = passed ? {} : { reason: 'Failed identity check' };
  const result = await inst.dispatch(action, payload);

  // 4. Persist
  if (result.success) {
    await db.workflowSnapshots.update({
      where: { id: parentInstanceId },
      data: { snapshot: inst.getSnapshot() },
    });
  }
}
```

## `resolveWait` signature

```ts
inst.resolveWait(
  stateId: string,
  externalSnapshot?: InstanceSnapshot,
): void
```

- Promotes the named state from `waiting` → `active`
- Increments `snapshot.version`
- Appends a `__resolve_wait:<stateId>` entry to the audit history
- Optionally stores `externalSnapshot` in the history for cross-workflow auditability

**Throws** if `stateId` is not a `WaitState` or is not currently `waiting`.

## Checking the paused position

```ts
inst.getCurrentStates();
// Returns IDs of all states with status 'active' OR 'waiting'.
// 'waiting' states are included because they represent the current position.

inst.getStateStatus('kyc-check');
// 'waiting' — the workflow is paused here
// 'active'  — resolveWait has been called, ready for a dispatch
```

## Dispatching before resolveWait

If you dispatch an action while the workflow is blocked on a `WaitState`, the dispatch returns `{ success: false, reason: 'no-active-source' }` because no active state has a matching transition. The instance state is unchanged.
