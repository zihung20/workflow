# WorkflowBuilder

Fluent builder for composing and validating a workflow definition.

```ts
import { WorkflowBuilder } from 'logic-workflow';
```


## Constructor

```ts
new WorkflowBuilder(config: { name: string; states: readonly [S, ...S[]] })
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `config.name` | `string` | Human-readable name for the workflow. Must be non-empty. |
| `config.states` | `readonly [S, ...S[]]` | Non-empty array of every state ID. Use `as const` so TypeScript infers literal types. |

**Throws** `Error` if `name` is empty or whitespace.

Passing the full set of state IDs upfront establishes the `TStates` generic at instantiation time. Every subsequent call — `addStep`, `addFork`, `addJoin`, `addWait`, `setInitial`, `setTerminal`, `addTransition` — is constrained to that union. IDEs autocomplete state IDs throughout the chain without any manual type annotations.

```ts
new WorkflowBuilder({
  name: 'my-workflow',
  states: ['draft', 'fork', 'branch-a', 'branch-b', 'joined', 'done'] as const,
})
```


## Call order

The builder is a fluent chain. Methods must be called in this order:

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

Registers an action and binds a Zod schema to its payload. Returns a new builder instance with an extended `TActions` generic — subsequent `.addTransition()` and `.dispatch()` calls are fully typed.

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | `string` | Action identifier, e.g. `'APPROVE'`. |
| `schema` | `ZodSchema<T>` | Zod schema validated at dispatch time. |

Must be called before any `addTransition` that uses this action name.


## `.addStep(id, options?)`

```ts
addStep(id: TStates, options?: { label?: string }): this
```

Creates and registers a `StepState`. The `id` is constrained to `TStates`.

**Throws** `Error` if a state with the same `id` is already registered.


## `.addFork(id, options)`

```ts
addFork(id: TStates, options: {
  label?: string;
  targets: [TStates, ...TStates[]];
}): this
```

Creates and registers a `ForkState`. Both `id` and every entry in `targets` are constrained to `TStates` — IDEs autocomplete to the declared state union.

**Throws** `Error` if `targets` is empty or if `id` is already registered.


## `.addJoin(id, options)`

```ts
addJoin(id: TStates, options: {
  label?: string;
  requires: [TStates, ...TStates[]];
  mode?: 'all' | 'any' | number;
}): this
```

Creates and registers a `JoinState`. Both `id` and every entry in `requires` are constrained to `TStates` — IDEs autocomplete to the declared state union.

| `mode` | Meaning |
|--------|---------|
| `'all'` (default) | Every state in `requires` must complete |
| `'any'` | At least one state in `requires` must complete |
| `number` | At least N states must complete (quorum) |

**Throws** `Error` if `requires` is empty or if `id` is already registered.


## `.addWait(id, options)`

```ts
addWait(id: TStates, options: {
  label?: string;
  externalName: string;
}): this
```

Creates and registers a `WaitState`. The `id` is constrained to `TStates`.

**Throws** `Error` if a state with the same `id` is already registered.


## `.setInitial(stateId)`

```ts
setInitial(stateId: TStates): this
```

Declares the single initial state. This state is set to `active` when a new instance is created.

**Throws** `Error` if called more than once.


## `.setTerminal(stateIds)`

```ts
setTerminal(stateIds: ReadonlyArray<TStates>): this
```

Declares one or more terminal states. When any terminal state becomes `active`, the instance rejects further dispatches.


## `.addTransition(transition)`

```ts
addTransition<K extends keyof TActions & string>(transition: {
  readonly from:   TStates;
  readonly to:     TStates;
  readonly on:     K;
  readonly guard?: IGuard<TActions[K]> | GuardFn<TActions[K]>;
}): this
```

Adds a directed transition arc. `from`, `to`, and `on` are constrained to registered values at compile time.

The `guard` field accepts either:
- A raw arrow function `(ctx) => boolean | Promise<boolean>` — automatically wrapped in `FnGuard`; `ctx.payload` is typed as `TActions[K]`
- Any `IGuard` instance (e.g. `Guard.inject('name')`, `Guard.and([...])`)

Multiple transitions from the same state on the same action are allowed. The engine applies all passing transitions in the order they were added.


## `.build()`

```ts
build(): Workflow<TActions>
```

Validates the workflow graph and returns an immutable `Workflow`. All structural checks run here.

**Throws** `Error` for any of the following:

| Violation | Example message |
|-----------|----------------|
| No initial state | `"Workflow requires exactly one initial state"` |
| No terminal states | `"Workflow requires at least one terminal state"` |
| Initial state not registered | `'Initial state "foo" is not registered'` |
| Terminal state not registered | `'Terminal state "foo" is not registered'` |
| Transition references unknown `from`/`to` | `'Transition from unregistered state "foo"'` |
| Transition uses undeclared action | `'Transition uses action "FOO" which has no registered schema'` |
| `ForkState` target not registered | `'ForkState "fork" references unregistered target "foo"'` |
| `JoinState` required state not registered | `'JoinState "join" requires unregistered state "foo"'` |
