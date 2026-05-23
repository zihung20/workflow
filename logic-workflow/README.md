# logic-workflow

A TypeScript library for modelling, executing, and visualizing **Standard Operating Procedures (SOPs)** as event-driven state machines. Built with kernel-level discipline: every action payload is Zod-validated, every failure is explicit, and persistence is purely functional.

---

## Table of Contents

- [Overview](#overview)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Core Concepts](#core-concepts)
  - [States](#states)
  - [Actions & Transitions](#actions--transitions)
  - [Guards](#guards)
  - [Workflow Instances & Persistence](#workflow-instances--persistence)
- [State Types](#state-types)
  - [StepState](#stepstate)
  - [ForkState](#forkstate)
  - [JoinState](#joinstate)
  - [SubWorkflowState](#subworkflowstate)
- [Guard Reference](#guard-reference)
  - [Guard.inject](#guardinject)
  - [Guard.fn](#guardfn)
  - [Guard.stateCompleted / Guard.stateActive](#guardstatecompleted--guardstateactive)
  - [Guard.and / Guard.or / Guard.not](#guardand--guardor--guardnot)
  - [Guard.always / Guard.never](#guardalways--guardnever)
- [WorkflowBuilder API](#workflowbuilder-api)
- [WorkflowInstance API](#workflowinstance-api)
  - [Dispatching actions](#dispatching-actions)
  - [Querying state](#querying-state)
  - [Guard injection](#guard-injection)
  - [Persistence](#persistence)
  - [Sub-workflow resolution](#sub-workflow-resolution)
- [DispatchResult](#dispatchresult)
- [Persistence & Snapshots](#persistence--snapshots)
- [Parallel Branches — Fork & Join](#parallel-branches--fork--join)
- [External Sub-workflows](#external-sub-workflows)
- [Visualization](#visualization)
  - [MermaidExporter](#mermaidexporter)
  - [JsonGraphExporter](#jsongraphexporter)
- [Architecture](#architecture)
- [Development](#development)

---

## Overview

`logic-workflow` lets you define a state machine for any multi-step process — an approval workflow, an onboarding flow, a compliance checklist — and then drive it forward via strongly-typed, Zod-validated action dispatches.

```
draft ──SUBMIT──▶ pending-approval ──APPROVE (guard: isManager)──▶ approved
                                   └──REJECT──────────────────────▶ rejected
```

**Key features:**

- **Strongly-typed action payloads** — each action (`SUBMIT`, `APPROVE`, …) declares its own Zod schema; `dispatch('APPROVE', payload)` is fully type-safe and validated at runtime
- **Guards** — arbitrary async predicates block or allow transitions; inject them at runtime via a named registry or inline via `Guard.fn()`
- **Parallel branches** — `ForkState` fans out to concurrent branches; `JoinState` synchronises them with `all`, `any`, or a quorum count
- **External sub-workflows** — `SubWorkflowState` pauses the parent workflow until your service layer calls `resolveSubWorkflow()`, with no coupling to I/O
- **Purely functional persistence** — `getSnapshot()` produces a plain JSON object; `restoreInstance(snapshot)` reconstructs exact state; you control the database
- **Visualization** — export to Mermaid `stateDiagram-v2` or a JSON graph object, optionally with live status overlays

---

## Installation

> This project uses **pnpm** exclusively. Do not use npm or yarn.

```sh
pnpm add logic-workflow zod
```

`zod` is a required peer dependency — schemas are the canonical source of truth for every action payload type.

---

## Quick Start

```ts
import { z } from 'zod';
import { WorkflowBuilder, StepState } from 'logic-workflow';
import { Guard } from 'logic-workflow';

// 1. Declare action schemas (types are inferred from them)
const purchaseOrder = new WorkflowBuilder('purchase-order')
  .defineAction('SUBMIT',  z.object({ submitterId: z.string() }))
  .defineAction('APPROVE', z.object({ reason: z.string(), approverId: z.string() }))
  .defineAction('REJECT',  z.object({ reason: z.string() }))

  // 2. Declare states
  .addState(new StepState('draft',            { label: 'Draft' }))
  .addState(new StepState('pending-approval', { label: 'Pending Approval' }))
  .addState(new StepState('approved',         { label: 'Approved' }))
  .addState(new StepState('rejected',         { label: 'Rejected' }))

  // 3. Wire transitions
  .setInitial('draft')
  .setTerminal(['approved', 'rejected'])
  .addTransition({ from: 'draft',            to: 'pending-approval', on: 'SUBMIT' })
  .addTransition({ from: 'pending-approval', to: 'approved',         on: 'APPROVE',
                   guard: Guard.inject('isManager') })
  .addTransition({ from: 'pending-approval', to: 'rejected',         on: 'REJECT' })
  .build();

// 4. Create an instance (one per order/ticket/run)
const inst = purchaseOrder.createInstance('po-001');

// 5. Inject named guards — happens after createInstance, before dispatch
inst.injectGuard('isManager', async (ctx) => {
  const approver = ctx.payload as { approverId: string };
  return myDb.isManager(approver.approverId);
});

// 6. Drive it forward
await inst.dispatch('SUBMIT', { submitterId: 'u1' });
// → { success: true, enteredStates: ['pending-approval'], ... }

const result = await inst.dispatch('APPROVE', { reason: 'LGTM', approverId: 'mgr1' });
if (result.success) {
  console.log(inst.getCurrentStates()); // ['approved']
  console.log(inst.isTerminal());       // true

  // 7. Persist after every successful dispatch
  await db.save(inst.getSnapshot());
}
```

---

## Core Concepts

### States

A **state** represents a step the workflow is currently "at". Every state has a unique `id` and a `kind` that determines its behaviour when entered:

| Kind | Class | Behaviour on entry |
|------|-------|--------------------|
| `step` | `StepState` | Becomes `active`; waits for a dispatch to advance |
| `fork` | `ForkState` | Immediately completes itself and activates all target states in the same tick |
| `join` | `JoinState` | Becomes `active` automatically once its prerequisite states have completed |
| `sub-workflow` | `SubWorkflowState` | Becomes `waiting`; blocked until the service layer calls `resolveSubWorkflow()` |

States transition between four statuses as the workflow progresses:

```
idle  →  active  →  completed
              ↘
           waiting (SubWorkflowState only, before resolveSubWorkflow)
```

### Actions & Transitions

An **action** is an event that can cause one or more state transitions. Each action:

1. Has a name declared via `.defineAction('NAME', zodSchema)`
2. Carries a typed, Zod-validated payload
3. May trigger transitions from whichever active states have a matching `from` edge

A **transition** is a directed edge `{ from, to, on, guard? }`:

```ts
.addTransition({ from: 'draft', to: 'pending-approval', on: 'SUBMIT' })
.addTransition({ from: 'pending-approval', to: 'approved', on: 'APPROVE', guard: Guard.inject('isManager') })
```

Multiple transitions can share the same action name (fan-out from parallel branches). All transitions whose `from` state is currently `active` and whose guard passes will fire simultaneously.

### Guards

A **guard** is an async predicate attached to a transition. The engine evaluates guards after Zod-validating the payload but before committing any state change. If all matching guards fail, the dispatch returns `{ success: false, reason: 'guard-failed' }` and the instance state is unchanged.

```ts
// Built-in factory — the recommended way to attach guards
Guard.inject('isManager')          // resolved at runtime from injectGuard()
Guard.fn((ctx) => ctx.payload.role === 'admin')  // inline, typed
Guard.stateCompleted('legal-review')             // true when that state has completed
Guard.and([Guard.inject('isManager'), Guard.stateCompleted('kyc')])  // all must pass
Guard.not(Guard.inject('isBlocked'))             // inverts the result
```

### Workflow Instances & Persistence

A single compiled `Workflow` object is an immutable factory. You call `workflow.createInstance(id)` once per SOP run (one per order, ticket, or approval request). Instances are completely independent — they share no state.

After each `dispatch`, call `inst.getSnapshot()` and write the returned JSON to your database. To resume later, load the JSON and call `workflow.restoreInstance(snapshot)`.

---

## State Types

### StepState

The fundamental building block. Becomes `active` when entered; waits for a `dispatch` to advance.

```ts
import { StepState } from 'logic-workflow';

new StepState('draft')
new StepState('pending-approval', { label: 'Pending Approval' })
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `label` | `string` | state `id` | Human-readable label used in visualizations |

---

### ForkState

A transient splitter. When entered it completes immediately and activates all targets in the same engine tick — no extra `dispatch` is needed.

```ts
import { ForkState } from 'logic-workflow';

new ForkState('parallel-reviews', {
  targets: ['legal-review', 'finance-review'],
})
```

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `targets` | `string[]` | yes | IDs of states to activate simultaneously |
| `label` | `string` | no | Visualization label |

```
start ──START──▶ fork ──▶ legal-review
                      └──▶ finance-review
```

After `START` is dispatched: both `legal-review` and `finance-review` are `active` in the same tick.

---

### JoinState

A synchronisation barrier. Monitors a set of prerequisite states and activates automatically once the threshold is met — no `dispatch` needed.

```ts
import { JoinState } from 'logic-workflow';

new JoinState('reviews-complete', {
  requires: ['legal-review', 'finance-review'],
  mode: 'all',   // 'all' | 'any' | quorum number
})
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `requires` | `string[]` | — | Prerequisite state IDs to monitor |
| `mode` | `'all' \| 'any' \| number` | `'all'` | Completion threshold |
| `label` | `string` | state `id` | Visualization label |

**`mode` values:**

| Value | Meaning |
|-------|---------|
| `'all'` | All required states must complete |
| `'any'` | At least one required state must complete |
| `number` | At least N required states must complete (quorum) |

Once the threshold is met, `JoinState` becomes `active` and behaves like a `StepState`, waiting for a transition action.

---

### SubWorkflowState

Delegates to an external, separately-running `WorkflowInstance`. The parent workflow pauses at `waiting` status until the service layer signals completion.

```ts
import { SubWorkflowState } from 'logic-workflow';

new SubWorkflowState('vendor-kyc', {
  subWorkflowName: 'kyc-workflow',
})
```

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `subWorkflowName` | `string` | yes | Name of the external workflow; used for documentation and visualization only |
| `label` | `string` | no | Visualization label |

**Lifecycle:**
1. Engine enters the state → status becomes `waiting`
2. Your service creates and drives the external `WorkflowInstance`
3. External workflow reaches terminal → your service calls `inst.resolveSubWorkflow(stateId)`
4. Status becomes `active` → normal dispatch can now advance past it

---

## Guard Reference

All guards are constructed via the `Guard` factory namespace. Every guard implements `IGuard` and is composable.

```ts
import { Guard } from 'logic-workflow';
```

---

### Guard.inject

```ts
Guard.inject(name: string): InjectedGuard
```

Declares a named guard placeholder that is resolved at runtime from the instance's `injectGuard()` registry. Use this when the guard implementation depends on your service layer (database, auth context, feature flags).

```ts
// In the workflow definition:
.addTransition({ from: 'a', to: 'b', on: 'GO', guard: Guard.inject('canApprove') })

// At runtime, before dispatching:
inst.injectGuard('canApprove', async (ctx) => {
  const payload = ctx.payload as { approverId: string };
  return myAuth.hasRole(payload.approverId, 'approver');
});
```

Dispatching without injecting the required guard throws:
```
Error: Guard "canApprove" has not been injected. Call instance.injectGuard("canApprove", fn).
```

---

### Guard.fn

```ts
Guard.fn<TPayload>(fn: (ctx: GuardContext<TPayload>) => boolean | Promise<boolean>): FnGuard<TPayload>
```

Wraps an inline function as a guard. Use `TPayload` to type the payload the guard inspects.

```ts
Guard.fn<{ role: string }>((ctx) => ctx.payload.role === 'admin')
```

The `ctx` object provides:
- `ctx.payload` — the validated action payload
- `ctx.instanceState` — read-only view of the current instance state
- `ctx.resolveGuard(name)` — internal; used by `InjectedGuard`

---

### Guard.stateCompleted / Guard.stateActive

```ts
Guard.stateCompleted(stateId: string): StateCompletedGuard
Guard.stateActive(stateId: string): StateActiveGuard
```

Pre-built guards that inspect the live instance state:

```ts
// Only allow APPROVE if the legal-review state has already completed
Guard.stateCompleted('legal-review')

// Only allow ESCALATE if the review state is currently active
Guard.stateActive('review')
```

---

### Guard.and / Guard.or / Guard.not

```ts
Guard.and(guards: IGuard[]): AndGuard   // all must pass
Guard.or(guards: IGuard[]):  OrGuard    // at least one must pass
Guard.not(guard: IGuard):    NotGuard   // inverts the result
```

Guards are composable:

```ts
Guard.and([
  Guard.inject('isManager'),
  Guard.stateCompleted('legal-review'),
  Guard.not(Guard.inject('isOnLeave')),
])
```

---

### Guard.always / Guard.never

```ts
Guard.always(): AlwaysGuard   // always returns true
Guard.never():  NeverGuard    // always returns false
```

Useful as test doubles or sentinel values.

---

## WorkflowBuilder API

`WorkflowBuilder<TActions>` is the fluent entry point. The generic `TActions` accumulates the payload type for each declared action — it is inferred automatically and should not be written by hand.

```ts
new WorkflowBuilder(name: string)
```

Every method except `.build()` returns `this` for chaining.

---

### `.defineAction(name, schema)`

```ts
.defineAction<K extends string, T>(name: K, schema: ZodSchema<T>): WorkflowBuilder<TActions & Record<K, T>>
```

Declares an action and binds a Zod schema to its payload. Must be called for every action name used in `.addTransition()`.

```ts
.defineAction('SUBMIT',  z.object({ submitterId: z.string() }))
.defineAction('APPROVE', z.object({ reason: z.string(), approverId: z.string() }))
```

---

### `.addState(state)`

```ts
.addState(state: IState): this
```

Registers a state. Pass any of `StepState`, `ForkState`, `JoinState`, or `SubWorkflowState`.

---

### `.setInitial(stateId)`

```ts
.setInitial(stateId: string): this
```

Designates the single initial state. This state is set to `active` when a new instance is created.

---

### `.setTerminal(stateIds)`

```ts
.setTerminal(stateIds: string[]): this
```

Designates one or more terminal states. When any of these states becomes `active`, the instance is marked terminal and rejects further dispatches.

---

### `.addTransition(transition)`

```ts
.addTransition(transition: {
  from: string;
  to:   string;
  on:   string;
  guard?: IGuard;
}): this
```

Adds a directed transition edge.

---

### `.build()`

```ts
.build(): Workflow<TActions>
```

Validates the workflow graph and returns an immutable `Workflow`. Throws if:

| Violation | Error |
|-----------|-------|
| No initial state set | `"initial state"` |
| No terminal states set | `"terminal state"` |
| Transition references an unknown state | `'"ghost"'` |
| Transition uses an undeclared action | `'"UNDECLARED"'` |
| `ForkState` target is not registered | `'"ghost"'` |
| `JoinState` required state is not registered | `'"ghost"'` |

---

## WorkflowInstance API

`WorkflowInstance<TActions>` is created by `workflow.createInstance(id)` or `workflow.restoreInstance(snapshot)`. Its type parameter `TActions` is inferred from the builder — `dispatch` and `canExecute` are fully typed.

---

### Dispatching actions

```ts
inst.dispatch<K extends keyof TActions>(action: K, payload: TActions[K]): Promise<DispatchResult>
```

Validates the payload, evaluates guards, applies state transitions atomically.

- On success: updates internal snapshot and returns `{ success: true, ... }`
- On failure: returns `{ success: false, reason: ..., ... }` with **no** state change

```ts
const result = await inst.dispatch('APPROVE', { reason: 'ok', approverId: 'mgr1' });
if (result.success) {
  await db.save(inst.getSnapshot()); // always persist after success
}
```

**Throws** (does not return failure):
- `ZodError` — if `payload` fails the action's Zod schema
- `Error` — if a named guard has not been injected

---

### Querying state

```ts
inst.getCurrentStates(): string[]
// Returns IDs of all states currently 'active' or 'waiting'.
// Waiting states are included because they represent the current position.

inst.getStateStatus(stateId: string): StateStatus
// 'idle' | 'active' | 'waiting' | 'completed'

inst.isTerminal(): boolean
// true once any terminal state has become active.

inst.getAvailableTransitions(): string[]
// Action names that have at least one transition from an active state.
// Does NOT evaluate guards — use for UI affordances.

inst.canExecute(action, payload): Promise<boolean>
// Dry-run dispatch: evaluates guards but commits no state change.
```

---

### Guard injection

```ts
inst.injectGuard<TPayload>(name: string, fn: GuardFn<TPayload>): this
```

Registers a named guard implementation. Returns `this` for chaining. Calling with the same name twice replaces the previous implementation.

Guard injections are **not persisted** in the snapshot — re-inject after every `restoreInstance`.

---

### Persistence

```ts
inst.getSnapshot(): InstanceSnapshot
// Returns a deep-cloned, JSON-serialisable snapshot.

workflow.restoreInstance(snapshot: InstanceSnapshot): WorkflowInstance<TActions>
// Reconstructs the exact instance state from a snapshot.
```

---

### Sub-workflow resolution

```ts
inst.resolveSubWorkflow(stateId: string, externalSnapshot?: InstanceSnapshot): void
```

Promotes a `SubWorkflowState` from `waiting` → `active`. Call this from your service layer once the external workflow reaches a terminal state.

- Increments `snapshot.version`
- Appends a `__resolve_sub_workflow:<stateId>` history entry
- Optionally stores the external snapshot for auditability

**Throws** if the state is not a `SubWorkflowState`, or is not currently `waiting`.

---

## DispatchResult

`dispatch` returns a discriminated union:

```ts
type DispatchResult = TransitionSuccess | TransitionBlocked;
```

**On success:**
```ts
interface TransitionSuccess {
  success: true;
  action: string;
  enteredStates: readonly string[];
  exitedStates:  readonly string[];
  snapshot: InstanceSnapshot;   // the new snapshot, before it is committed internally
}
```

**On failure:**
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

```ts
const result = await inst.dispatch('APPROVE', payload);

if (!result.success) {
  switch (result.reason) {
    case 'guard-failed':   return res.status(403).json({ error: 'Not authorized' });
    case 'terminal-state': return res.status(409).json({ error: 'Workflow is closed' });
    default:               return res.status(400).json({ error: result.reason });
  }
}
```

---

## Persistence & Snapshots

The snapshot is a plain, JSON-serialisable object — no circular references, no class instances. Write it to any persistence layer.

```ts
interface InstanceSnapshot {
  instanceId:     string;
  workflowName:   string;
  version:        number;                           // increments on every successful dispatch
  stateStatuses:  Readonly<Record<string, StateStatus>>;
  isTerminal:     boolean;
  history:        readonly HistoryEntry[];
  createdAt:      string;                           // ISO 8601
  updatedAt:      string;
}
```

**Typical service-layer pattern (Prisma example):**

```ts
// Create a new instance
const inst = purchaseOrder.createInstance(orderId);
await prisma.workflowSnapshot.create({
  data: { id: orderId, snapshot: inst.getSnapshot() },
});

// Resume an existing instance
const row = await prisma.workflowSnapshot.findUniqueOrThrow({ where: { id: orderId } });
const inst = purchaseOrder.restoreInstance(row.snapshot);
inst.injectGuard('isManager', myGuardFn); // re-inject after restore

// Dispatch and save
const result = await inst.dispatch('APPROVE', payload);
if (result.success) {
  await prisma.workflowSnapshot.update({
    where: { id: orderId },
    data:  { snapshot: inst.getSnapshot() },
  });
}
```

**Version conflicts** — `snapshot.version` increments atomically. To detect concurrent updates, include the version in your `WHERE` clause:

```ts
const updated = await prisma.workflowSnapshot.updateMany({
  where: { id: orderId, version: knownVersion },
  data:  { snapshot: inst.getSnapshot() },
});
if (updated.count === 0) throw new Error('Concurrent update detected');
```

---

## Parallel Branches — Fork & Join

Use `ForkState` to split execution into concurrent branches, and `JoinState` to synchronise them.

```ts
const procurement = new WorkflowBuilder('procurement')
  .defineAction('START',        z.object({}))
  .defineAction('LEGAL_DONE',   z.object({}))
  .defineAction('FINANCE_DONE', z.object({}))
  .defineAction('FINALIZE',     z.object({}))
  .addState(new StepState('start'))
  .addState(new ForkState('fork', { targets: ['legal', 'finance'] }))
  .addState(new StepState('legal'))
  .addState(new StepState('finance'))
  .addState(new JoinState('join', { requires: ['legal', 'finance'], mode: 'all' }))
  .addState(new StepState('approved'))
  .setInitial('start')
  .setTerminal(['approved'])
  .addTransition({ from: 'start',   to: 'fork',     on: 'START' })
  .addTransition({ from: 'legal',   to: 'join',     on: 'LEGAL_DONE' })
  .addTransition({ from: 'finance', to: 'join',     on: 'FINANCE_DONE' })
  .addTransition({ from: 'join',    to: 'approved', on: 'FINALIZE' })
  .build();

const inst = procurement.createInstance('prc-001');

await inst.dispatch('START', {});
// → legal and finance are BOTH active simultaneously

await inst.dispatch('LEGAL_DONE', {});
// → legal: completed, finance: still active, join: idle

await inst.dispatch('FINANCE_DONE', {});
// → finance: completed, join: active (auto-activated by fixed-point loop)

await inst.dispatch('FINALIZE', {});
// → approved: active, terminal
```

The engine runs a **fixed-point loop** after each dispatch: it keeps re-evaluating all `JoinState`s until no new activations occur, so nested forks/joins resolve correctly in a single tick.

---

## External Sub-workflows

`SubWorkflowState` lets the parent SOP wait for a separately-driven external process — a third-party API call, a long-running background job, or a child `WorkflowInstance`.

```ts
const vendorOnboarding = new WorkflowBuilder('vendor-onboarding')
  .defineAction('SUBMIT',     z.object({}))
  .defineAction('KYC_PASSED', z.object({}))
  .defineAction('KYC_FAILED', z.object({}))
  .addState(new StepState('draft'))
  .addState(new SubWorkflowState('kyc-check', { subWorkflowName: 'vendor-kyc' }))
  .addState(new StepState('approved'))
  .addState(new StepState('rejected'))
  .setInitial('draft')
  .setTerminal(['approved', 'rejected'])
  .addTransition({ from: 'draft',     to: 'kyc-check', on: 'SUBMIT' })
  .addTransition({ from: 'kyc-check', to: 'approved',  on: 'KYC_PASSED' })
  .addTransition({ from: 'kyc-check', to: 'rejected',  on: 'KYC_FAILED' })
  .build();

// Service layer — when KYC finishes:
async function onKycComplete(parentId: string, kycPassed: boolean, kycSnapshot: InstanceSnapshot) {
  const row = await db.load(parentId);
  const inst = vendorOnboarding.restoreInstance(row.snapshot);

  // Promote waiting → active, optionally storing the external snapshot for audit
  inst.resolveSubWorkflow('kyc-check', kycSnapshot);

  // Now dispatch the appropriate transition
  const action = kycPassed ? 'KYC_PASSED' : 'KYC_FAILED';
  await inst.dispatch(action, {});
  await db.save(inst.getSnapshot());
}
```

The engine has **no polling, no callbacks, no I/O**. The `subWorkflowName` string is purely documentary — the engine never resolves or calls it. All async orchestration lives in your service layer.

---

## Visualization

Visualization is a separate package entry point with zero impact on the core engine:

```ts
import { MermaidExporter, JsonGraphExporter } from 'logic-workflow/visualization';
```

Both exporters accept `workflow.getDefinition()` and an optional `InstanceSnapshot` for live status overlays.

---

### MermaidExporter

```ts
MermaidExporter.export(definition: WorkflowDefinition, snapshot?: InstanceSnapshot): string
```

Returns a `stateDiagram-v2` string. Paste into any Mermaid-compatible renderer (GitHub markdown, Mermaid Live Editor, Obsidian, Notion, etc.).

**State kind indicators in labels:**

| Kind | Suffix |
|------|--------|
| `step` | _(none)_ |
| `fork` | ` ⑂` |
| `join` | ` ⑁` |
| `sub-workflow` | ` ⤴` |

**Example — purchase order:**

```ts
const diagram = MermaidExporter.export(purchaseOrder.getDefinition());
```

```
stateDiagram-v2
  draft : Draft
  pending_approval : Pending Approval
  approved : Approved
  rejected : Rejected

  [*] --> draft
  draft --> pending_approval : SUBMIT
  pending_approval --> approved : APPROVE
  pending_approval --> rejected : REJECT
  approved --> [*]
  rejected --> [*]
```

**Live status overlay** — pass a snapshot to annotate states with CSS classes:

```ts
MermaidExporter.export(purchaseOrder.getDefinition(), inst.getSnapshot())
// Appends: class pending_approval active
```

CSS classes emitted: `active`, `waiting`, `completed`. Style them in your renderer.

---

### JsonGraphExporter

```ts
JsonGraphExporter.export(definition: WorkflowDefinition, snapshot?: InstanceSnapshot): JsonGraph
```

Returns a plain JSON-serialisable object for use with D3.js, React Flow, Cytoscape.js, or any `{ nodes, edges }` renderer.

```ts
interface JsonGraph {
  name:  string;
  nodes: JsonGraphNode[];
  edges: JsonGraphEdge[];
  meta: {
    initialStateId:   string;
    terminalStateIds: string[];
    actionNames:      string[];
    instance?: { instanceId: string; version: number; isTerminal: boolean };
  };
}

interface JsonGraphNode {
  id:          string;
  kind:        string;        // 'step' | 'fork' | 'join' | 'sub-workflow'
  label:       string;
  isInitial:   boolean;
  isTerminal:  boolean;
  status?:     string;        // present when snapshot provided
  targets?:    string[];      // ForkState only
  join?:       { requires: string[]; mode: string | number }; // JoinState only
  subWorkflowName?: string;   // SubWorkflowState only
}

interface JsonGraphEdge {
  id:       string;
  from:     string;
  to:       string;
  action:   string;
  hasGuard: boolean;
}
```

**Example:**

```ts
const graph = JsonGraphExporter.export(purchaseOrder.getDefinition());
console.log(JSON.stringify(graph, null, 2));
```

```json
{
  "name": "purchase-order",
  "nodes": [
    { "id": "draft",            "kind": "step", "label": "Draft",            "isInitial": true,  "isTerminal": false },
    { "id": "pending-approval", "kind": "step", "label": "Pending Approval", "isInitial": false, "isTerminal": false },
    { "id": "approved",         "kind": "step", "label": "Approved",         "isInitial": false, "isTerminal": true  },
    { "id": "rejected",         "kind": "step", "label": "Rejected",         "isInitial": false, "isTerminal": true  }
  ],
  "edges": [
    { "id": "draft__SUBMIT__pending-approval__0",   "from": "draft",            "to": "pending-approval", "action": "SUBMIT",  "hasGuard": false },
    { "id": "pending-approval__APPROVE__approved__1","from": "pending-approval", "to": "approved",         "action": "APPROVE", "hasGuard": true  },
    { "id": "pending-approval__REJECT__rejected__2", "from": "pending-approval", "to": "rejected",         "action": "REJECT",  "hasGuard": false }
  ],
  "meta": {
    "initialStateId":   "draft",
    "terminalStateIds": ["approved", "rejected"],
    "actionNames":      ["SUBMIT", "APPROVE", "REJECT"]
  }
}
```

---

## Architecture

The codebase is organized into four strict layers. **Imports flow downward only** — no layer may import from a layer above it.

```
logic-workflow/src/
│
├── types/               ← Interfaces, enums, discriminated unions. No logic, no imports from other layers.
│   ├── state.ts         ← StateKind, StateStatus, IState, IForkState, IJoinState, ISubWorkflowState, JoinMode
│   ├── guard.ts         ← IGuard, GuardFn, GuardContext
│   ├── transition.ts    ← TransitionDefinition
│   ├── instance.ts      ← ReadonlyInstanceState, InstanceSnapshot, DispatchResult, HistoryEntry
│   └── workflow.ts      ← WorkflowDefinition, ActionPayloadMap
│
├── states/              ← Concrete state implementations. Import from types/ only.
│   ├── base.ts
│   ├── step-state.ts
│   ├── fork-state.ts
│   ├── join-state.ts
│   └── sub-workflow-state.ts
│
├── guards/              ← Guard implementations and factory. Import from types/ only.
│   ├── primitives.ts    ← AlwaysGuard, NeverGuard, FnGuard
│   ├── inject-guard.ts  ← InjectedGuard (resolved at evaluate time)
│   ├── and-guard.ts
│   ├── or-guard.ts
│   ├── not-guard.ts
│   ├── state-guard.ts   ← StateCompletedGuard, StateActiveGuard
│   └── factory.ts       ← Guard namespace (the recommended public API)
│
├── core/                ← Engine, builder, instance. Imports from types/, states/, guards/.
│   ├── builder.ts       ← WorkflowBuilder — fluent definition API
│   ├── workflow.ts      ← Workflow — immutable factory (createInstance / restoreInstance)
│   ├── instance.ts      ← WorkflowInstance — mutable runtime state
│   ├── engine.ts        ← WorkflowEngine — pure, stateless transition evaluator
│   └── registry.ts      ← StateRegistry, GuardRegistry
│
└── visualization/       ← Exporters. Imports from types/ only. core/ must never import this.
    ├── exporter.ts      ← IExporter<TResult> interface
    ├── mermaid.ts       ← MermaidExporter → stateDiagram-v2 string
    └── json-graph.ts    ← JsonGraphExporter → JsonGraph object
```

The visualization layer is a **separate package entry point** (`logic-workflow/visualization`). The core engine has zero knowledge of its existence.

---

## Development

### Prerequisites

- Node.js ≥ 18
- pnpm ≥ 8

### Setup

```sh
git clone <repo>
cd logic-workflow
pnpm install
```

### Scripts

| Command | Description |
|---------|-------------|
| `pnpm build` | Compile to `dist/` (ESM + CJS + `.d.ts`) |
| `pnpm test` | Run all 72 tests once with Vitest |
| `pnpm typecheck` | Full TypeScript type check with no emit |
| `pnpm dev` | Build in watch mode |

### Running the examples

Three fully-working examples live in `examples/`. Run them directly with `tsx` (no build step required):

```sh
# Train engineer pre-departure checklist
# Demonstrates: ForkState + JoinState (parallel inspections), Guard.fn,
#               Zod payload validation rejection
npx tsx examples/engineer-predeparture-checklist.ts

# MRT Operation Control Centre — service disruption SOP
# Demonstrates: multi-role Guard.inject, parallel notification branches,
#               SubWorkflowState + resolveSubWorkflow, JsonGraphExporter
npx tsx examples/occ-disruption-sop.ts

# Station opening checklist
# Demonstrates: Guard.fn on sequential steps, canExecute() UI query,
#               snapshot/restoreInstance crash-recovery, audit trail,
#               Mermaid live-status overlay
npx tsx examples/station-opening-checklist.ts
```

### Build output

```
dist/
├── index.js               # ESM entry
├── index.cjs              # CommonJS entry
├── index.d.ts             # Type declarations (ESM)
├── index.d.cts            # Type declarations (CJS)
└── visualization/
    ├── index.js
    ├── index.cjs
    ├── index.d.ts
    └── index.d.cts
```

### Project rules

This project is governed by [`CLAUDE.md`](./CLAUDE.md). Key constraints:

- **pnpm only** — never npm or yarn
- **`any` is banned** — use `unknown` and narrow explicitly
- **No silent failures** — every error is thrown with a descriptive message
- **Layer imports are one-directional** — `visualization/` cannot be imported by `core/`
- **Types are derived from Zod schemas** — never the reverse
- **TSDoc required on every exported symbol**
