# Introduction

`flowyd` is a TypeScript library for building typed, auditable workflow state machines. You describe a process as a graph of states and transitions, the engine executes it, and you persist the result as plain JSON.

It is designed for Standard Operating Procedures (SOPs) — real-world processes where the sequence matters, roles matter, and every step must be auditable.

**[Full documentation →](https://your-docs-site.com)**


## The selling point: compile-time safety on everything

Most workflow libraries let you write strings wherever you please. A typo in a state ID silently creates dead code. A wrong action name fails at runtime. A mismatched payload produces a confusing error in production.

`flowyd` catches all of these at compile time.

### State IDs are locked at declaration

All state IDs are declared upfront in `createWorkflow`. TypeScript infers the union from that array. Every subsequent call — `addStep`, `addFork`, `addJoin`, `addWait`, `setInitial`, `setTerminal`, `addTransition` — is constrained to exactly that set.

```ts
const wf = createWorkflow({
  name: 'approval',
  states: ['draft', 'review', 'approved', 'rejected'],
})
  .addStep('approveddd'); // TS2345: Argument of type '"approveddd"' is not assignable
                          // to parameter of type '"draft" | "review" | "approved" | "rejected"'
```

IDEs autocomplete state IDs throughout the entire chain. No typos make it to runtime.

### Action names are locked at dispatch

`defineAction` registers each action and binds a Zod schema to its payload. The `TActions` generic accumulates across calls, so `dispatch` only accepts action names you defined.

```ts
const wf = createWorkflow({ name: 'approval', states: ['draft', 'approved'] })
  .defineAction('SUBMIT', z.object({ submitterId: z.string() }))
  .defineAction('APPROVE', z.object({ approverId: z.string() }))
  // ...
  .build();

const inst = wf.createInstance('po-001');

await inst.dispatch('APPROV', { approverId: 'x' });
//                  ^^^^^^
// TS2345: Argument of type '"APPROV"' is not assignable to
// parameter of type '"SUBMIT" | "APPROVE"'
```

### Payload shapes are checked twice — at compile time and at runtime

The payload type is inferred from the Zod schema. Pass the wrong shape and TypeScript rejects it before the file even compiles. If somehow a wrong shape reaches `dispatch` at runtime (e.g. from an untyped API boundary), Zod throws immediately before any state changes.

```ts
await inst.dispatch('APPROVE', { approver: 'x' });
//                               ^^^^^^^^
// TS2345: Object literal may only specify known properties,
// and 'approver' does not exist in type '{ approverId: string }'
```

### Fork targets and join requires are autocompleted

`addFork` and `addJoin` constrain their `targets` and `requires` arrays to the declared state union:

```ts
createWorkflow({ name: 'proc', states: ['start', 'fork', 'a', 'b', 'join', 'end'] })
  .addFork('fork', { targets: ['a', 'b'] })      // autocompletes to the 6 declared IDs
  .addJoin('join', { requires: ['a', 'b'], mode: 'all' })  // same
  .addFork('fork', { targets: ['a', 'missspelled'] })
  //                                ^^^^^^^^^^^^ compile error
```


## What it is not

- **Not a visual designer.** You define workflows in TypeScript code. The companion [web-runner](../dev/contributing#web-runner) provides a browser UI, but code is the source of truth.
- **Not an orchestration server.** There is no hosted runtime, no queue, no scheduler. `flowyd` is a pure library — you provide the storage, the transport, and the trigger mechanism.
- **Not opinionated about storage.** Snapshots are plain JSON objects. Write them to Postgres, Redis, a file, or in memory — the library does not care.


## Next steps

- [Core Concepts](./concepts) — understand states, transitions, guards, and snapshots
- [Installation](./installation) — get up and running in five minutes
- [Examples](../examples/) — see complete, runnable workflows
