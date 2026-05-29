# Add guards to transitions

Guards are async predicates on transitions. If a guard returns `false`, the transition does not fire and the instance state is unchanged.

## Guard evaluation sequence

1. Payload validated against the action's Zod schema (throws `ZodError` on failure).
2. All transitions whose `from` state is `active` and whose `on` matches the action are collected.
3. Each transition's guard is evaluated.
4. Transitions whose guard returns `true` fire; the rest are skipped.
5. If **no** transitions fired, dispatch returns `{ success: false, reason: 'guard-failed' }`.

## Guard.inject — for I/O-dependent checks

Use `Guard.inject` when the guard implementation depends on your service layer (database, auth, feature flags). The implementation is supplied at runtime via `injectGuard`.

```ts
// In the workflow definition — no I/O here
.addTransition({
  from: 'pending-approval',
  to: 'approved',
  on: 'APPROVE',
  guard: Guard.inject('isManager'),
})

// At runtime — wire the implementation
inst.injectGuard('isManager', async (ctx) => {
  return myAuthService.hasRole(ctx.payload.approverId, 'manager');
});
```

Dispatching without injecting throws immediately:

```
Error: Guard "isManager" has not been injected. Call instance.injectGuard("isManager", fn).
```

## Inline guard — for pure checks

Use an inline function when the guard is a pure expression with no external dependencies.

```ts
.addTransition({
  from: 'safety-walk-done',
  to: 'systems-active',
  on: 'ACTIVATE_SYSTEMS',
  guard: (ctx) => ctx.payload.allOnline === true,
})
```

The inline function receives a `GuardContext` with:

- `ctx.payload` — the validated action payload
- `ctx.instanceState` — read-only view of all state statuses

## Guard.fn — explicit wrapper

`Guard.fn` is the explicit equivalent of an inline function. Use it when you want the typed generic parameter:

```ts
Guard.fn<{ role: string }>((ctx) => ctx.payload.role === 'admin');
```

## Guard.stateCompleted / Guard.stateActive

Pre-built guards that inspect live instance state:

```ts
// Allow APPROVE only after legal-review has completed
guard: Guard.stateCompleted('legal-review');

// Allow ESCALATE only while incident-triage is still active
guard: Guard.stateActive('incident-triage');
```

## Guard.and / Guard.or / Guard.not — composition

All guards implement `IGuard` and compose arbitrarily:

```ts
// All conditions must pass
guard: Guard.and([
  Guard.inject('isManager'),
  Guard.stateCompleted('legal-review'),
  Guard.not(Guard.inject('isOnLeave')),
]);

// At least one must pass
guard: Guard.or([Guard.inject('isSupervisor'), Guard.inject('isAdmin')]);

// Invert any guard
guard: Guard.not(Guard.inject('isBlocked'));
```

## Guard.always / Guard.never

Useful in tests:

```ts
Guard.always(); // always returns true
Guard.never(); // always returns false
```

## Multiple transitions on the same action

Attach multiple transitions from the same state on the same action, each with a different guard. The engine applies all transitions whose guard passes — use complementary guards to enforce mutual exclusion:

```ts
.addTransition({ from: 's', to: 'a', on: 'DECIDE', guard: Guard.inject('isApprover') })
.addTransition({ from: 's', to: 'b', on: 'DECIDE', guard: Guard.not(Guard.inject('isApprover')) })
// Exactly one fires — the complementary pair guarantees it
```

## Guards are not persisted

Guard functions are runtime behaviour. They are never included in `getSnapshot()`. After every `restoreInstance`, re-inject any named guards before dispatching:

```ts
const inst = workflow.restoreInstance(snapshot);
inst.injectGuard('isManager', myGuardFn);
```
