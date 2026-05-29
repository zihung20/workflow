# flowyd

Strongly-typed SOP state machines for TypeScript.

Build Standard Operating Procedures as typed workflow state machines. The compiler catches every typo in a state ID, every wrong action name, and every mismatched payload shape — before your code runs.

**[Full documentation →](https://your-docs-site.com/guide/)**

---

## The selling point: safety you can feel

Most workflow libraries accept strings everywhere. A typo silently creates dead code. `flowyd` makes that impossible.

### Typo in a state ID — compile error

```ts
const wf = createWorkflow({ name: 'approval' })
  .addStep('draft')
  .addStep('review')
  .addStep('approved')
  .addStep('rejected')
  .setInitial('drft'); // typo
// TS2345: Argument of type '"drft"' is not assignable to
// parameter of type '"draft" | "review" | "approved" | "rejected"'
```

### Wrong action name at dispatch — compile error

```ts
await inst.dispatch('APPROV', { approverId: 'x' });
//                  ^^^^^^
// TS2345: Argument of type '"APPROV"' is not assignable to
// parameter of type '"SUBMIT" | "APPROVE" | "REJECT"'
```

### Wrong payload shape — compile error + Zod runtime check

```ts
await inst.dispatch('APPROVE', { approver: 'mgr-1' });
//                               ^^^^^^^^
// TS2345: Object literal may only specify known properties,
// and 'approver' does not exist in type '{ approverId: string }'
```

### Fork targets and join requires are autocompleted

```ts
.addStep('legal')
.addStep('finance')
.addFork('fork', { targets: ['legal', 'finance'] })       // autocompletes to registered state IDs
.addJoin('join', { requires: ['legal', 'finannce'], mode: 'all' })
//                                      ^^^^^^^^^ compile error
```

---

## Install

```sh
pnpm add flowyd zod
```

`zod` is a required peer dependency.

---

## Quick example

```ts
import { z } from 'zod';
import { createWorkflow, Guard } from 'flowyd';

const purchaseOrder = createWorkflow({ name: 'purchase-order' })
  .defineAction('SUBMIT', z.object({ submitterId: z.string() }))
  .defineAction('APPROVE', z.object({ approverId: z.string(), reason: z.string() }))
  .defineAction('REJECT', z.object({ reason: z.string() }))

  .addStep('draft')
  .addStep('pending-approval')
  .addStep('approved')
  .addStep('rejected')

  .setInitial('draft')
  .setTerminal(['approved', 'rejected'])

  .addTransition({ from: 'draft', to: 'pending-approval', on: 'SUBMIT' })
  .addTransition({
    from: 'pending-approval',
    to: 'approved',
    on: 'APPROVE',
    guard: Guard.inject('isManager'),
  })
  .addTransition({ from: 'pending-approval', to: 'rejected', on: 'REJECT' })

  .build();

const inst = purchaseOrder.createInstance('po-001');

inst.injectGuard('isManager', async (ctx) => {
  return ctx.payload.approverId === 'mgr-1'; // replace with your auth check
});

await inst.dispatch('SUBMIT', { submitterId: 'alice' });
await inst.dispatch('APPROVE', { approverId: 'mgr-1', reason: 'LGTM' });

console.log(inst.getCurrentStates()); // ['approved']
console.log(inst.isTerminal()); // true

const snapshot = inst.getSnapshot(); // plain JSON — save wherever you want
```

---

## Features

- **Compile-time state ID safety** — `TStates` accumulates per `addStep`/`addFork`/`addJoin`/`addWait` call; typos caught immediately
- **Typed actions and payloads** — `dispatch` and `canExecute` typed end-to-end from `defineAction`
- **Zod-validated at every boundary** — runtime payload validation from the same schema
- **Parallel branches** — `ForkState` fans out; `JoinState` synchronises (`all` / `any` / quorum)
- **External wait states** — `WaitState` pauses until `resolveWait` is called
- **Purely functional persistence** — `getSnapshot()` / `restoreInstance()`, no storage opinions
- **Typed instance context** — `setContext(schema)` makes context required at `createInstance` time; guards read it via `ctx.context`; `getContext()` returns `TContext | undefined` with no cast
- **Fully generic type chain** — `WorkflowDefinition<TContext, TStates>`, `InstanceSnapshot<TContext, TStates>`, `HistoryEntry<TContext, TStates>`, `DispatchResult<TContext, TStates, TAction>` — context, state IDs, and action type flow end-to-end with no boundary casts; `WorkflowEngine.dispatch` returns a fully typed result so `WorkflowInstance` needs zero internal casts
- **Rewind** — `instance.rewind(version)` returns an independent deep-cloned `InstanceSnapshot<TContext>` for any past version, with accurate stateStatuses and context
- **Typed instance queries** — `getCurrentStates()` returns `TStates[]`; `getAvailableTransitions()` returns `(keyof TActions & string)[]`; state-ID and action-name unions propagate from the builder all the way to the instance
- **Composable guards** — `Guard.inject`, `Guard.fn`, `Guard.and`, `Guard.or`, `Guard.not`
- **Built-in visualization** — Mermaid `stateDiagram-v2` and JSON graph for React Flow / D3

---

## Documentation

| Section                                                         | What's there                                  |
| --------------------------------------------------------------- | --------------------------------------------- |
| [Introduction & type safety](https://your-docs-site.com/guide/) | What it is, compile-time guarantees in detail |
| [Core Concepts](https://your-docs-site.com/guide/concepts)      | States, transitions, guards, snapshots        |
| [Examples](https://your-docs-site.com/examples/)                | Four complete runnable workflows              |
| [Scenarios](https://your-docs-site.com/scenarios/)              | Task-based guides ("I want to…")              |
| [API Reference](https://your-docs-site.com/api/)                | Complete method reference                     |
| [Developer Guide](https://your-docs-site.com/dev/)              | Architecture, contributing, design decisions  |

---

## Requirements

- Node.js ≥ 20
- TypeScript ≥ 5.0 with `strict: true`
- `zod` ≥ 3

---

## License

MIT
