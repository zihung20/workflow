# Installation

## Requirements

- Node.js ≥ 20
- TypeScript ≥ 5.0 with `strict: true`
- `zod` ≥ 3 (peer dependency)

## Install

```sh
pnpm add logic-workflow zod
```

`zod` is a required peer dependency. Every action payload type is derived from a Zod schema.

## TypeScript configuration

Your `tsconfig.json` must have these options enabled. The library's types rely on all of them:

```json
{
  "compilerOptions": {
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true
  }
}
```

## Import paths

```ts
// Core library — WorkflowBuilder, Guard, state types, instance types
import { createWorkflow, Guard } from 'logic-workflow';
import type { WorkflowInstance, InstanceSnapshot, DispatchResult } from 'logic-workflow';

// Visualization — tree-shakeable separate entry point
import { MermaidExporter, JsonGraphExporter } from 'logic-workflow/visualization';
```

The visualization entry point is separate so bundlers can tree-shake it from applications that do not use it.

## Quick start

The complete purchase-order workflow in one file:

```ts
import { z } from 'zod';
import { createWorkflow, Guard } from 'logic-workflow';

const purchaseOrder = createWorkflow({
  name: 'purchase-order',
  states: ['draft', 'pending-approval', 'approved', 'rejected'],
})
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

// Create an instance and inject the guard
const inst = purchaseOrder.createInstance('po-001');
inst.injectGuard('isManager', async (ctx) => {
  return ctx.payload.approverId === 'mgr-1'; // replace with your auth check
});

// Drive it forward
await inst.dispatch('SUBMIT', { submitterId: 'alice' });
await inst.dispatch('APPROVE', { approverId: 'mgr-1', reason: 'Looks good' });

console.log(inst.getCurrentStates()); // ['approved']
console.log(inst.isTerminal());       // true

// Persist
const snapshot = inst.getSnapshot();
// await db.save(snapshot)
```

Continue to [Core Concepts](./concepts) to understand what each piece does, or jump straight to [Examples](../examples/) to see complete real-world workflows.
