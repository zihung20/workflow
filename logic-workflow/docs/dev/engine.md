# Fixed-point engine

The engine must handle `ForkState` (which immediately activates multiple states) and `JoinState` (which activates when a threshold of prerequisite states complete). Both of these are "automatic" — they do not require the caller to dispatch an extra action. Yet both can chain: a `ForkState` can target a `JoinState`'s prerequisites, and a `JoinState` can target another `ForkState`.

The fixed-point loop is how all of this resolves in a single `dispatch` call.

## The algorithm

After applying the explicit transitions for a dispatched action, the engine enters a loop:

```
loop:
  for each JoinState in the workflow:
    if the join is idle AND its mode threshold is now satisfied:
      activate the join

  for each newly active ForkState:
    complete the fork
    activate all its targets

  if nothing changed in this iteration → break
```

This is a **fixed-point iteration** (also called Kleene iteration). The loop terminates when a full pass produces no new state changes. Because states only move forward (`idle → active → completed`) and never backwards, the loop is guaranteed to terminate.

## Why it matters

Consider this graph:

```
start ──GO──▶ fork-1 ⑂
               /       \
             a           b
               \       /
             join-1 ⑁ (all)
                │
             fork-2 ⑂ ← automatically entered when join-1 activates
               /       \
             c           d
```

Without the fixed-point loop, activating `join-1` would require the caller to dispatch a second action to enter `fork-2`. With the loop, a single `GO` dispatch resolves the entire chain — `fork-1` fires, `a` and `b` activate, then on later dispatches `join-1` fires and immediately `fork-2` fires, all within a single `dispatch` call.

## Termination proof

The state space is finite. Every state has exactly four statuses: `idle`, `active`, `waiting`, `completed`. Transitions are monotonic — a state can only move to a later status, never backwards. Therefore the number of possible state-space configurations is bounded, and each iteration of the fixed-point loop strictly decreases the number of `idle` states or terminates unchanged. The loop must terminate in at most `|states|` iterations.

## Fork atomicity

A `ForkState` is entered and completed in the same iteration of the fixed-point loop — it is never left in `active` status between iterations. This means `getCurrentStates()` will never return a `ForkState` ID. Forks are transient by design: they are routing nodes, not positions.

## JoinState activation condition

A `JoinState` activates when:

- Its current status is `idle`
- The number of `completed` states in `requires` satisfies the `mode` threshold:
  - `'all'` → all states in `requires` are `completed`
  - `'any'` → at least one state in `requires` is `completed`
  - `number N` → at least N states in `requires` are `completed`

The check runs after every transition application, including after transitions triggered by fork resolution. This means joins that were not in scope for the original dispatch can still activate if their prerequisites complete as a side effect.
