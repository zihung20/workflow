# Save and restore state

`flowyd` is purely functional with respect to storage. The engine never touches a database — it produces and consumes plain JSON snapshots.

## The snapshot object

```ts
interface InstanceSnapshot {
  instanceId: string;
  workflowName: string;
  version: number;          // increments on every successful dispatch or resolveWait
  stateStatuses: Readonly<Record<string, 'idle' | 'active' | 'waiting' | 'completed'>>;
  isTerminal: boolean;
  history: readonly HistoryEntry[];
  createdAt: string;        // ISO 8601
  updatedAt: string;
}
```

The snapshot is the **complete state** — no hidden in-memory fields. Save it after every successful dispatch.

## Save after dispatch

```ts
const result = await inst.dispatch('APPROVE', payload);

if (result.success) {
  await db.workflowSnapshots.upsert({
    where: { id: inst.getSnapshot().instanceId },
    create: { id: inst.getSnapshot().instanceId, data: inst.getSnapshot() },
    update: { data: inst.getSnapshot() },
  });
}
```

Do not save on failure — the snapshot is unchanged when `success` is `false`.

## Restore an instance

```ts
const row = await db.workflowSnapshots.findUniqueOrThrow({ where: { id: orderId } });
const inst = purchaseOrder.restoreInstance(row.data);

// Guards are not stored — re-inject them
inst.injectGuard('isManager', myGuardFn);
```

`restoreInstance` validates that `snapshot.workflowName` matches the workflow object to prevent restoring the wrong workflow's snapshot.

## Optimistic concurrency

`snapshot.version` increments on every successful state change. Use it in your `WHERE` clause to detect concurrent updates:

```ts
const row = await db.workflowSnapshots.findUniqueOrThrow({ where: { id: orderId } });
const savedVersion = row.data.version;

const inst = purchaseOrder.restoreInstance(row.data);
inst.injectGuard('isManager', myGuardFn);

const result = await inst.dispatch('APPROVE', payload);

if (result.success) {
  const updated = await db.workflowSnapshots.updateMany({
    where: { id: orderId, version: savedVersion }, // only update if nothing changed since we loaded
    data: { data: inst.getSnapshot() },
  });

  if (updated.count === 0) {
    throw new Error(`Concurrent update on workflow instance "${orderId}"`);
  }
}
```

This pattern works with any database that supports conditional updates.

## Crash recovery

Because the snapshot is the complete state, resuming after a crash is identical to a planned hand-off:

```ts
// Load the last persisted snapshot and continue — no replay, no event sourcing required
const inst = purchaseOrder.restoreInstance(lastSavedSnapshot);
inst.injectGuard('isManager', myGuardFn);
```

## Audit history

`snapshot.history` is an append-only array:

```ts
interface HistoryEntry {
  action: string;      // action name, or '__resolve_wait:<stateId>' for resolveWait calls
  timestamp: string;   // ISO 8601
  enteredStates: string[];
  exitedStates: string[];
}
```

Query it directly to produce an audit trail:

```ts
const trail = inst.getSnapshot().history.map((e) => ({
  action: e.action,
  at: e.timestamp,
  from: e.exitedStates,
  to: e.enteredStates,
}));
```

Blocked dispatches (`success: false`) do **not** appear in history.
