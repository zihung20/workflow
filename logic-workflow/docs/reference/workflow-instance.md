# WorkflowInstance

The mutable runtime object for a single SOP run. Created by `workflow.createInstance(id)` or `workflow.restoreInstance(snapshot)`.

```ts
import type { WorkflowInstance } from 'logic-workflow';
```

`WorkflowInstance<TActions>` carries the same `TActions` generic as the builder — `dispatch` and `canExecute` are fully typed.


## Creating instances

```ts
// New instance — initial state is set to 'active'
const inst = workflow.createInstance('instance-id');

// Restored instance — state is exactly as it was when snapshot was taken
const inst = workflow.restoreInstance(snapshot);
```


## `dispatch`

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

See [DispatchResult](./dispatch-result) for the full union.


## `canExecute`

```ts
canExecute<K extends keyof TActions & string>(
  action: K,
  payload: TActions[K],
): Promise<boolean>
```

Dry-run: evaluates guards but commits no state change. Use to drive UI affordances ("is this button enabled right now?").

Returns `false` if:
- The workflow is terminal
- The action has no transitions from any active state
- All matching guards fail


## `getCurrentStates`

```ts
getCurrentStates(): string[]
```

Returns IDs of all states currently `active` or `waiting`. States with `waiting` status are included because they represent the current position in the workflow.


## `getStateStatus`

```ts
getStateStatus(stateId: string): StateStatus
// StateStatus = 'idle' | 'active' | 'waiting' | 'completed'
```

**Throws** `Error` if `stateId` is not registered.


## `isTerminal`

```ts
isTerminal(): boolean
```

Returns `true` once any terminal state has become `active`. Once terminal, all subsequent `dispatch` calls return `{ success: false, reason: 'terminal-state' }`.


## `getAvailableTransitions`

```ts
getAvailableTransitions(): string[]
```

Returns action names that have at least one transition from a currently `active` state. Does **not** evaluate guards — use for displaying available actions in a UI without the cost of a guard round-trip.


## `injectGuard`

```ts
injectGuard<TPayload>(
  name: string,
  fn: GuardFn<TPayload>,
): this
```

Registers a named guard implementation. Returns `this` for chaining.

- Calling with the same name twice replaces the previous implementation.
- Guard injections are **not persisted** in the snapshot — re-inject after every `restoreInstance`.


## `getSnapshot`

```ts
getSnapshot(): InstanceSnapshot
```

Returns a deep-cloned, JSON-serialisable snapshot of the current instance state. Safe to mutate — does not affect the instance.


## `resolveWait`

```ts
resolveWait(
  stateId: string,
  externalSnapshot?: InstanceSnapshot,
): void
```

Promotes a `WaitState` from `waiting` → `active`. Call this from your service layer once the external process completes.

- Increments `snapshot.version`
- Appends a `__resolve_wait:<stateId>` history entry
- Optionally stores `externalSnapshot` for audit

**Throws** if:
- `stateId` is not a `WaitState`
- The state is not currently `waiting`
