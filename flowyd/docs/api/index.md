# API Reference

Complete reference for all public APIs.

| Page                                                     | Covers                                                                                                                                                                       |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [WorkflowBuilder](./workflow-builder)                    | `createWorkflow`, `defineAction`, `addStep`, `addFork`, `addJoin`, `addWait`, `setInitial`, `setTerminal`, `addTransition`, `build`, `createInstance`, `restoreInstance`     |
| [WorkflowInstance & DispatchResult](./workflow-instance) | `dispatch`, `canExecute`, `getCurrentStates`, `getStateStatus`, `isTerminal`, `getAvailableTransitions`, `injectGuard`, `getSnapshot`, `resolveWait`, `DispatchResult` union |
| [State Types](./state-types)                             | `StepState`, `ForkState`, `JoinState`, `WaitState`, `StateStatus`, `StateKind`                                                                                               |
| [Guards](./guards)                                       | `Guard.inject`, `Guard.fn`, `Guard.and`, `Guard.or`, `Guard.not`, `Guard.stateCompleted`, `Guard.stateActive`, `Guard.always`, `Guard.never`, `IGuard`, `GuardContext`       |
| [Visualization](./visualization)                         | `MermaidExporter`, `JsonGraphExporter`, `JsonGraph`, `JsonGraphNode`, `JsonGraphEdge`                                                                                        |

## Import paths

```ts
// Core
import { createWorkflow, Guard } from 'flowyd';
import type { WorkflowInstance, InstanceSnapshot, DispatchResult } from 'flowyd';
import type { IGuard, GuardContext } from 'flowyd';

// Visualization (separate, tree-shakeable)
import { MermaidExporter, JsonGraphExporter } from 'flowyd/visualization';
import type { JsonGraph } from 'flowyd/visualization';
```
