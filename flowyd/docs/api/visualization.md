# Visualization

Exporters live in a separate entry point and have zero impact on the core engine. Import from `flowyd/visualization`:

```ts
import { MermaidExporter, JsonGraphExporter } from 'flowyd/visualization';
```

Both exporters are stateless — pass a definition and an optional snapshot.

## MermaidExporter

```ts
MermaidExporter.export(
  definition: WorkflowDefinition,
  snapshot?: InstanceSnapshot,
): string
```

Returns a `stateDiagram-v2` string. Paste into any Mermaid-compatible renderer — GitHub markdown, Mermaid Live Editor, Obsidian, Notion.

```ts
// Static diagram (no live state)
const diagram = MermaidExporter.export(workflow.getDefinition());

// With live status overlay — colours states by current status
const diagram = MermaidExporter.export(workflow.getDefinition(), inst.getSnapshot());
```

### State kind indicators

| Kind   | Notation                                                  |
| ------ | --------------------------------------------------------- |
| `step` | Plain label                                               |
| `fork` | `state id <<fork>>` (rendered as UML synchronisation bar) |
| `join` | `state id <<join>>` (rendered as UML synchronisation bar) |
| `wait` | Label suffix ` ⤴`                                         |

### Live status overlay

When a snapshot is provided, states are annotated with CSS class directives:

```
class pending_approval active
class legal_review completed
class payment_processing waiting
```

Classes emitted: `active`, `waiting`, `completed`. Style in your renderer:

```css
.active {
  fill: #2196f3;
}
.waiting {
  fill: #ff9800;
}
.completed {
  fill: #4caf50;
}
```

## JsonGraphExporter

```ts
JsonGraphExporter.export(
  definition: WorkflowDefinition,
  snapshot?: InstanceSnapshot,
): JsonGraph
```

Returns a plain JSON-serialisable object for use with D3.js, React Flow, Cytoscape.js, or any graph renderer.

### JsonGraph

```ts
interface JsonGraph {
  name: string;
  nodes: JsonGraphNode[];
  edges: JsonGraphEdge[];
  meta: {
    initialStateId: string;
    terminalStateIds: string[];
    actionNames: string[];
    instance?: {
      instanceId: string;
      version: number;
      isTerminal: boolean;
    };
  };
}
```

### JsonGraphNode

```ts
interface JsonGraphNode {
  id: string;
  kind: 'step' | 'fork' | 'join' | 'wait';
  label: string;
  isInitial: boolean;
  isTerminal: boolean;
  status?: StateStatus; // present only when a snapshot is provided
  targets?: string[]; // ForkState only
  join?: {
    requires: string[];
    mode: string | number;
  }; // JoinState only
  externalName?: string; // WaitState only
}
```

### JsonGraphEdge

```ts
interface JsonGraphEdge {
  id: string; // "{from}__{action}__{to}__{index}"
  from: string;
  to: string;
  action: string;
  hasGuard: boolean;
}
```

`hasGuard` lets dashboards highlight which transitions require authorization.

## Getting the definition

Both exporters require a `WorkflowDefinition` from:

```ts
const definition = workflow.getDefinition();
```

The definition is the immutable compiled representation produced by `WorkflowBuilder.build()`. It is safe to store and reuse.
