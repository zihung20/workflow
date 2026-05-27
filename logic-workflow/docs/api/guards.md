# Guards

Guards are async predicates attached to transitions. All guards implement `IGuard` and are composable.

```ts
import { Guard } from 'logic-workflow';
import type { IGuard, GuardContext } from 'logic-workflow';
```


## IGuard interface

```ts
interface IGuard<TPayload = unknown> {
  evaluate(ctx: GuardContext<TPayload>): boolean | Promise<boolean>;
}
```

## GuardContext

```ts
interface GuardContext<TPayload> {
  payload: TPayload;                  // validated action payload
  instanceState: ReadonlyInstanceState; // read-only view of all state statuses
}
```


## Guard factory methods

All guards are constructed through the `Guard` namespace. Do not instantiate guard classes directly.

### `Guard.inject(name)`

```ts
Guard.inject(name: string): InjectedGuard
```

Declares a named guard placeholder. The implementation is supplied at runtime via `inst.injectGuard(name, fn)`. Use this when the guard depends on I/O (database, auth service, feature flags).

```ts
.addTransition({
  from: 'pending-approval',
  to: 'approved',
  on: 'APPROVE',
  guard: Guard.inject('isManager'),
})

// At runtime:
inst.injectGuard('isManager', async (ctx) => {
  return authService.hasRole(ctx.payload.approverId, 'manager');
});
```

**Throws** at evaluation time if the named guard has not been injected:
```
Error: Guard "isManager" has not been injected. Call instance.injectGuard("isManager", fn).
```

### `Guard.fn(fn)`

```ts
Guard.fn<TPayload>(
  fn: (ctx: GuardContext<TPayload>) => boolean | Promise<boolean>
): FnGuard<TPayload>
```

Wraps an inline function as a guard. The generic parameter types `ctx.payload`.

```ts
Guard.fn<{ role: string }>((ctx) => ctx.payload.role === 'admin')
```

You can also pass the function inline directly in `addTransition` — `Guard.fn` is only needed when you want the typed generic.

### `Guard.stateCompleted(stateId)` / `Guard.stateActive(stateId)`

```ts
Guard.stateCompleted(stateId: string): StateCompletedGuard
Guard.stateActive(stateId: string): StateActiveGuard
```

Pre-built guards that inspect the live instance:

```ts
// Allow APPROVE only after legal-review has completed
guard: Guard.stateCompleted('legal-review')

// Allow ESCALATE only while incident-triage is still active
guard: Guard.stateActive('incident-triage')
```

### `Guard.and(guards)` / `Guard.or(guards)`

```ts
Guard.and(guards: IGuard[]): AndGuard
Guard.or(guards: IGuard[]):  OrGuard
```

Logical composition. Composition is arbitrarily deep — `AndGuard` and `OrGuard` accept any `IGuard[]`.

```ts
guard: Guard.and([
  Guard.inject('isManager'),
  Guard.stateCompleted('legal-review'),
  Guard.not(Guard.inject('isOnLeave')),
])

guard: Guard.or([Guard.inject('isSupervisor'), Guard.inject('isAdmin')])
```

### `Guard.not(guard)`

```ts
Guard.not(guard: IGuard): NotGuard
```

Inverts any guard:

```ts
guard: Guard.not(Guard.inject('isBlocked'))
```

### `Guard.always()` / `Guard.never()`

```ts
Guard.always(): AlwaysGuard  // evaluate() always returns true
Guard.never():  NeverGuard   // evaluate() always returns false
```

Useful in tests to force a transition to always fire or always block.


## Multiple transitions on the same action

Multiple transitions from the same state on the same action are allowed. The engine evaluates all and fires those whose guard passes. Use complementary guards to enforce mutual exclusion:

```ts
.addTransition({ from: 's', to: 'approved', on: 'DECIDE', guard: Guard.inject('isApprover') })
.addTransition({ from: 's', to: 'rejected', on: 'DECIDE', guard: Guard.not(Guard.inject('isApprover')) })
```


## Guards are not persisted

Guard implementations are functions — they are never stored in `getSnapshot()`. After every `restoreInstance`, re-inject named guards before dispatching:

```ts
const inst = workflow.restoreInstance(snapshot);
inst.injectGuard('isManager', myGuardFn);
```
