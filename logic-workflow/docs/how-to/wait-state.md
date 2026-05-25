# Pause for an external process

`WaitState` lets a parent workflow pause until an external signal arrives — a third-party API, a background job, a webhook, or any other asynchronous process — before continuing.


## How it works

When the engine enters a `WaitState`:

1. The state's status becomes `waiting` (not `active`).
2. The parent workflow is effectively paused — `dispatch` calls that require this state to be `active` will return `{ success: false, reason: 'no-active-source' }`.
3. Your service layer creates and drives the external process independently.
4. When the external process finishes, your service calls `inst.resolveWait(stateId)`.
5. Status becomes `active` — normal transitions can now advance past it.

The engine has **no polling, no callbacks, no I/O**. The `externalName` string is purely documentary.


## Code

```ts
import { z } from 'zod';
import { createWorkflow } from 'logic-workflow';

const vendorOnboarding = createWorkflow({
  name: 'vendor-onboarding',
  states: ['draft', 'kyc-check', 'approved', 'rejected'],
})
  .defineAction('SUBMIT',     z.object({ vendorId: z.string() }))
  .defineAction('KYC_PASSED', z.object({}))
  .defineAction('KYC_FAILED', z.object({ reason: z.string() }))

  .addStep('draft')
  .addWait('kyc-check', { externalName: 'vendor-kyc' })
  .addStep('approved')
  .addStep('rejected')

  .setInitial('draft')
  .setTerminal(['approved', 'rejected'])
  .addTransition({ from: 'draft',     to: 'kyc-check', on: 'SUBMIT' })
  .addTransition({ from: 'kyc-check', to: 'approved',  on: 'KYC_PASSED' })
  .addTransition({ from: 'kyc-check', to: 'rejected',  on: 'KYC_FAILED' })
  .build();
```


## Service-layer pattern

Your service is responsible for orchestrating the external process and signalling the parent workflow when it completes:

```ts
// Called when the external KYC service posts a webhook
async function onKycComplete(
  parentInstanceId: string,
  passed: boolean,
  kycSnapshot: InstanceSnapshot,  // optional — stored for audit
) {
  // 1. Load the parent instance
  const row = await db.workflowSnapshots.findUnique({ where: { id: parentInstanceId } });
  const inst = vendorOnboarding.restoreInstance(row.data);

  // 2. Promote waiting → active, optionally attaching the external snapshot for audit
  inst.resolveWait('kyc-check', kycSnapshot);

  // 3. Dispatch the appropriate transition
  const action = passed ? 'KYC_PASSED' : 'KYC_FAILED';
  const payload = passed ? {} : { reason: 'Failed identity check' };
  const result = await inst.dispatch(action, payload);

  // 4. Persist
  if (result.success) {
    await db.workflowSnapshots.update({
      where: { id: parentInstanceId },
      data:  { snapshot: inst.getSnapshot() },
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

- Promotes the named state from `waiting` → `active`.
- Increments `snapshot.version`.
- Appends a `__resolve_wait:<stateId>` entry to the audit history.
- Optionally stores `externalSnapshot` in the history for auditability.

**Throws** if:
- `stateId` is not a `WaitState`.
- The state is not currently `waiting`.


## Querying the paused position

```ts
inst.getCurrentStates()
// Returns IDs of all states with status 'active' OR 'waiting'.
// 'waiting' states are included because they represent where the workflow is.
```

Use `inst.getStateStatus('kyc-check')` to distinguish `active` from `waiting`.
