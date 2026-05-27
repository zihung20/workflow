# WorkflowInstance & DispatchResult

`WorkflowInstance<TActions>` is the mutable runtime object for a single workflow run. Create it via `workflow.createInstance(id)` or `workflow.restoreInstance(snapshot)`.

```ts
import type { WorkflowInstance, InstanceSnapshot, DispatchResult } from 'flowyd';
```


## WorkflowInstance methods

### `dispatch(action, payload)`

```ts
dispatch<K extends keyof TActions & string>(
  action: K,
  payload: TActions[K],
): Promise<DispatchResult>
```

Validates the payload, evaluates guards, and applies state transitions atomically.

- **On success** — updates internal snapshot, returns `TransitionSuccess`
- **On failure** — returns `TransitionBlocked` with **no state change**

**Throws** (does not return failure):
- `ZodError` — payload fails the action's Zod schema
- `Error` — a named guard has not been injected

Both `action` and `payload` are fully typed from the workflow's `TActions` generic.

### `canExecute(action, payload)`

```ts
canExecute<K extends keyof TActions & string>(
  action: K,
  payload: TActions[K],
): Promise<boolean>
```

Dry-run: evaluates guards but commits no state change. Use to drive UI affordances (enable/disable buttons). Returns `false` if the workflow is terminal, the action has no transitions from any active state, or all matching guards fail.

### `getCurrentStates()`

```ts
getCurrentStates(): string[]
```

Returns IDs of all states currently `active` or `waiting`. Both statuses are included because they represent the current position in the workflow.

### `getStateStatus(stateId)`

```ts
getStateStatus(stateId: string): StateStatus
// 'idle' | 'active' | 'waiting' | 'completed'
```

**Throws** if `stateId` is not registered in this workflow.

### `isTerminal()`

```ts
isTerminal(): boolean
```

Returns `true` once any terminal state is `active`. Once terminal, all subsequent `dispatch` calls return `{ success: false, reason: 'terminal-state' }`.

### `getAvailableTransitions()`

```ts
getAvailableTransitions(): string[]
```

Returns action names that have at least one transition from a currently `active` state. Does **not** evaluate guards — use for displaying available action names without the cost of a guard round-trip. Use `canExecute` when you need guard evaluation.

### `injectGuard(name, fn)`

```ts
injectGuard<TPayload>(
  name: string,
  fn: (ctx: GuardContext<TPayload>) => boolean | Promise<boolean>,
): this
```

Registers a named guard implementation. Returns `this` for chaining. Calling with the same name twice replaces the previous implementation. Guard injections are **not persisted** in snapshots — re-inject after every `restoreInstance`.

### `getSnapshot()`

```ts
getSnapshot(): InstanceSnapshot
```

Returns a deep-cloned, JSON-serialisable snapshot of the current instance state. Safe to mutate — does not affect the instance.

### `resolveWait(stateId, externalSnapshot?)`

```ts
resolveWait(
  stateId: string,
  externalSnapshot?: InstanceSnapshot,
): void
```

Promotes a `WaitState` from `waiting` → `active`. Call from your service layer when the external process completes. Increments `snapshot.version` and appends a `__resolve_wait:<stateId>` history entry. Optionally stores `externalSnapshot` in the history for cross-workflow auditability.

**Throws** if `stateId` is not a `WaitState` or is not currently `waiting`.


## DispatchResult

`dispatch` returns a discriminated union on the `success` field:

```ts
type DispatchResult = TransitionSuccess | TransitionBlocked;
```

### TransitionSuccess

```ts
interface TransitionSuccess {
  success: true;
  action: string;
  enteredStates: readonly string[]; // states that became active/waiting this tick
  exitedStates: readonly string[];  // states that completed this tick
  snapshot: InstanceSnapshot;       // the new snapshot (already committed internally)
}
```

### TransitionBlocked

```ts
interface TransitionBlocked {
  success: false;
  action: string;
  reason:
    | 'terminal-state'    // workflow has already ended
    | 'invalid-action'    // no transitions exist for this action name
    | 'no-active-source'  // action exists but none of its source states are active
    | 'guard-failed';     // all matching transitions were blocked by guards
  activeStates: string[];
}
```

When `success` is `false`, the instance state is **unchanged**.

### Reason reference

| Reason | Meaning | Suggested HTTP response |
|---|---|---|
| `terminal-state` | Workflow has already reached a terminal state | 409 Conflict |
| `invalid-action` | Action name has no transitions defined | 400 Bad Request |
| `no-active-source` | Action is defined but no active state has this transition | 400 Bad Request |
| `guard-failed` | Transitions exist but all guards blocked | 403 Forbidden |

### Exhaustive switch

```ts
const result = await inst.dispatch('APPROVE', payload);

if (!result.success) {
  switch (result.reason) {
    case 'guard-failed':
      return res.status(403).json({ error: 'Not authorized to approve' });
    case 'terminal-state':
      return res.status(409).json({ error: 'This workflow has already ended' });
    case 'no-active-source':
    case 'invalid-action':
      return res.status(400).json({ error: result.reason });
  }
}

await db.save(inst.getSnapshot());
```

### What throws vs what returns failure

`dispatch` **throws** for programming errors — bugs in the caller that should never reach production:

- `ZodError` — payload does not match the action's declared schema
- `Error` — a named `Guard.inject(name)` has not been injected via `injectGuard`

It **returns** `TransitionBlocked` for valid domain outcomes — things the caller's business logic must handle (guard blocked, terminal, wrong order of operations).
