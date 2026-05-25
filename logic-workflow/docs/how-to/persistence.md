# Save and restore state

`logic-workflow` is purely functional with respect to storage. The engine never touches a database — it only produces and consumes plain JSON objects called snapshots.


## The snapshot object

```ts
interface InstanceSnapshot {
  instanceId:    string;
  workflowName:  string;
  version:       number;             // increments on every successful dispatch or resolveWait
  stateStatuses: Readonly<Record<string, StateStatus>>;
  isTerminal:    boolean;
  history:       readonly HistoryEntry[];
  createdAt:     string;             // ISO 8601
  updatedAt:     string;
}
```

`stateStatuses` maps every state ID to `'idle' | 'active' | 'waiting' | 'completed'`. The snapshot is a **complete picture of the instance** — no hidden in-memory state.


## Save after every successful dispatch

```ts
const result = await inst.dispatch('APPROVE', payload);

if (result.success) {
  await db.workflowSnapshots.upsert({
    where:  { id: inst.getSnapshot().instanceId },
    create: { id: inst.getSnapshot().instanceId, data: inst.getSnapshot() },
    update: { data: inst.getSnapshot() },
  });
}
```

Do not save on failure — the snapshot is unchanged when `dispatch` returns `success: false`.


## Restore an instance

```ts
const row  = await db.workflowSnapshots.findUniqueOrThrow({ where: { id: orderId } });
const inst = purchaseOrder.restoreInstance(row.data);

// Re-inject guards — they are never stored in the snapshot
inst.injectGuard('isManager', myGuardFn);
```

`restoreInstance` validates the snapshot's `workflowName` against the workflow object to prevent accidentally restoring the wrong workflow's snapshot.


## Handling version conflicts (optimistic concurrency)

`snapshot.version` increments atomically on every successful state change. Use it in your database `WHERE` clause to detect concurrent updates:

```ts
const row     = await db.workflowSnapshots.findUniqueOrThrow({ where: { id: orderId } });
const inst    = purchaseOrder.restoreInstance(row.data);
const version = row.data.version;

inst.injectGuard('isManager', myGuardFn);
const result = await inst.dispatch('APPROVE', payload);

if (result.success) {
  const updated = await db.workflowSnapshots.updateMany({
    where: { id: orderId, version },   // only update if version matches what we loaded
    data:  { data: inst.getSnapshot() },
  });

  if (updated.count === 0) {
    throw new Error(`Concurrent update on workflow instance "${orderId}"`);
  }
}
```

This pattern works with any database that supports conditional updates.


## Audit history

`snapshot.history` is an append-only array of entries:

```ts
interface HistoryEntry {
  action:        string;
  timestamp:     string;    // ISO 8601
  enteredStates: string[];
  exitedStates:  string[];
}
```

`resolveWait` adds an entry with the synthetic action name `__resolve_wait:<stateId>`. You can query the history array directly to produce an audit trail.


## Crash recovery

Because every state is encoded in the snapshot, resuming after a crash is the same as resuming after a planned hand-off:

```ts
// Load the last persisted snapshot and continue
const inst = purchaseOrder.restoreInstance(lastGoodSnapshot);
inst.injectGuard('isManager', myGuardFn);

// The workflow continues from exactly where it left off
```

No in-memory replay, no event sourcing infrastructure required — the snapshot is the state.
