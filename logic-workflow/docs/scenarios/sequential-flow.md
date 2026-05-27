# Define a sequential flow

The minimal pattern: a straight line of steps, each waiting for a specific action before advancing.

## The pattern

```
s1 ──ACTION_A──▶ s2 ──ACTION_B──▶ s3 ✓
```

## Code

```ts
import { z } from 'zod';
import { createWorkflow } from 'logic-workflow';

const linear = createWorkflow({
  name: 'my-workflow',
  states: ['s1', 's2', 's3'],
})
  .defineAction('ACTION_A', z.object({ actorId: z.string() }))
  .defineAction('ACTION_B', z.object({ actorId: z.string() }))

  .addStep('s1')
  .addStep('s2')
  .addStep('s3')

  .setInitial('s1')
  .setTerminal(['s3'])

  .addTransition({ from: 's1', to: 's2', on: 'ACTION_A' })
  .addTransition({ from: 's2', to: 's3', on: 'ACTION_B' })

  .build();

const inst = linear.createInstance('run-001');

await inst.dispatch('ACTION_A', { actorId: 'alice' });
console.log(inst.getCurrentStates()); // ['s2']

await inst.dispatch('ACTION_B', { actorId: 'bob' });
console.log(inst.getCurrentStates()); // ['s3']
console.log(inst.isTerminal());       // true
```

## Rules

- **Call order matters.** The fluent chain must follow: `defineAction` → `addStep/addFork/addJoin/addWait` → `setInitial/setTerminal` → `addTransition` → `build`.
- **Every declared state must be registered.** Each ID in `states` must appear in exactly one `addStep`, `addFork`, `addJoin`, or `addWait` call. `build()` throws if any are missing.
- **At least one terminal state is required.** A workflow with no terminal state throws at `build()`.
- **Dispatch on a terminal instance always returns `{ success: false, reason: 'terminal-state' }`.**

## Multiple transitions from one state

A state can have transitions for different actions, enabling branching:

```ts
const approval = createWorkflow({
  name: 'approval',
  states: ['draft', 'approved', 'rejected'],
})
  .defineAction('APPROVE', z.object({}))
  .defineAction('REJECT', z.object({ reason: z.string() }))

  .addStep('draft')
  .addStep('approved')
  .addStep('rejected')

  .setInitial('draft')
  .setTerminal(['approved', 'rejected'])

  .addTransition({ from: 'draft', to: 'approved', on: 'APPROVE' })
  .addTransition({ from: 'draft', to: 'rejected', on: 'REJECT' })

  .build();
```

The first action dispatched from `draft` determines which branch is taken. The other transition is never used for that instance.
