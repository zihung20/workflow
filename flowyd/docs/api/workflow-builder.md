# WorkflowBuilder

Fluent builder that compiles a workflow definition. Use `createWorkflow()` — do not call `new WorkflowBuilder()` directly.

```ts
import { createWorkflow } from 'flowyd';
```

## `createWorkflow(config)`

```ts
function createWorkflow<const TStates extends string>(config: {
  name: string;
  states: readonly [TStates, ...TStates[]];
}): WorkflowBuilder<Record<never, never>, TStates>
```

Instantiates a `WorkflowBuilder` and infers the `TStates` literal union from the `states` array. Every subsequent call is constrained to that union — typos are compile errors.

```ts
const wf = createWorkflow({
  name: 'purchase-order',
  states: ['draft', 'review', 'approved', 'rejected'],
});
```

**Throws** if `name` is empty or whitespace.

## Call order

Methods must be called in this sequence:

1. `defineAction()` — register each action and its payload schema
2. `addStep()` / `addFork()` / `addJoin()` / `addWait()` — register every state
3. `setInitial()` / `setTerminal()` — declare entry and exit points
4. `addTransition()` — wire states together
5. `build()` — validate and compile

## `.defineAction(name, schema)`

```ts
defineAction<K extends string, T>(
  name: K,
  schema: ZodSchema<T>,
): WorkflowBuilder<TActions & Record<K, T>, TStates>
```

Registers an action and binds a Zod schema to its payload. Returns a new builder specialization with extended `TActions` — downstream calls to `addTransition`, `dispatch`, and `canExecute` are all typed to registered action names.

```ts
.defineAction('APPROVE', z.object({ approverId: z.string(), reason: z.string() }))
```

## `.addStep(id, options?)`

```ts
addStep(id: TStates, options?: { label?: string }): this
```

Registers a `StepState`. Becomes `active` on entry; waits for a dispatch to advance.

## `.addFork(id, options)`

```ts
addFork(id: TStates, options: {
  targets: [TStates, ...TStates[]];
  label?: string;
}): this
```

Registers a `ForkState`. On entry it immediately completes and activates all `targets` in the same engine tick. The `targets` array is constrained to the declared `TStates` union — a misspelled target is a compile error.

## `.addJoin(id, options)`

```ts
addJoin(id: TStates, options: {
  requires: [TStates, ...TStates[]];
  mode: 'all' | 'any' | number;
  label?: string;
}): this
```

Registers a `JoinState`. Activates automatically when the `mode` threshold of `requires` states is satisfied. The `requires` array is constrained to `TStates`.

| `mode` | Activates when |
|---|---|
| `'all'` | All states in `requires` are `completed` |
| `'any'` | At least one state in `requires` is `completed` |
| `number N` | At least N states in `requires` are `completed` |

## `.addWait(id, options?)`

```ts
addWait(id: TStates, options?: { externalName?: string; label?: string }): this
```

Registers a `WaitState`. On entry its status becomes `waiting` (not `active`). Resume with `inst.resolveWait(id)`.

`externalName` is documentary — it appears in snapshots and visualization but has no runtime effect.

## `.setInitial(id)`

```ts
setInitial(id: TStates): this
```

Marks one state as the initial state. It becomes `active` when `createInstance` is called.

## `.setTerminal(ids)`

```ts
setTerminal(ids: [TStates, ...TStates[]]): this
```

Marks one or more states as terminal. Once any terminal state is `active`, all subsequent `dispatch` calls return `{ success: false, reason: 'terminal-state' }`.

## `.addTransition(def)`

```ts
addTransition(def: {
  from: TStates;
  to: TStates;
  on: keyof TActions & string;
  guard?: IGuard | GuardFn;
}): this
```

Wires a directed edge. `from`, `to`, and `on` are all constrained to registered IDs and action names.

`guard` accepts either a `Guard.*` factory result or an inline function `(ctx: GuardContext) => boolean | Promise<boolean>`.

## `.build()`

```ts
build(): Workflow<TActions, TStates>
```

Validates the complete definition and returns an immutable `Workflow` object.

**Throws** if:
- Any declared state was not registered via `addStep/addFork/addJoin/addWait`
- No initial state was set
- No terminal state was set
- A transition references an unregistered state or action

## `Workflow` object (returned by `build()`)

### `.createInstance(instanceId)`

```ts
createInstance(instanceId: string): WorkflowInstance<TActions>
```

Creates a new `WorkflowInstance` with the initial state set to `active`.

### `.restoreInstance(snapshot)`

```ts
restoreInstance(snapshot: InstanceSnapshot): WorkflowInstance<TActions>
```

Reconstructs a `WorkflowInstance` from a previously saved snapshot. Validates that `snapshot.workflowName` matches this workflow.

**Throws** if the snapshot's `workflowName` does not match.

### `.getDefinition()`

```ts
getDefinition(): WorkflowDefinition
```

Returns the immutable compiled definition. Pass to `MermaidExporter.export()` or `JsonGraphExporter.export()`.
