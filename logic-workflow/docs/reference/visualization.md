# Visualization

Exporters live in a separate entry point and have zero impact on the core engine. The `core/` layer never imports from `visualization/`.

```ts
import { MermaidExporter, JsonGraphExporter } from 'logic-workflow/visualization';
```

Both exporters are stateless — call them with a definition object and an optional snapshot.


## MermaidExporter

```ts
MermaidExporter.export(
  definition: WorkflowDefinition,
  snapshot?:  InstanceSnapshot,
): string
```

Returns a `stateDiagram-v2` string. Paste into any Mermaid-compatible renderer.

```ts
const diagram = MermaidExporter.export(workflow.getDefinition());
// Paste into GitHub markdown, Mermaid Live Editor, Obsidian, Notion, etc.

// With live status overlay
const diagram = MermaidExporter.export(workflow.getDefinition(), inst.getSnapshot());
```

### State kind indicators

| Kind | Label suffix |
|------|-------------|
| `step` | _(none)_ |
| `fork` | ` ⑂` |
| `join` | ` ⑁` |
| `wait` | ` ⤴` |

### Live status overlay

When a snapshot is provided, states are annotated with CSS class directives:

```
class pending_approval active
class legal_review completed
```

CSS classes emitted: `active`, `waiting`, `completed`. Style them in your renderer:

```css
.active   { fill: #2196F3; }
.waiting  { fill: #FF9800; }
.completed { fill: #4CAF50; }
```


## JsonGraphExporter

```ts
JsonGraphExporter.export(
  definition: WorkflowDefinition,
  snapshot?:  InstanceSnapshot,
): JsonGraph
```

Returns a plain JSON-serialisable `{ nodes, edges }` object for use with D3.js, React Flow, Cytoscape.js, or any graph renderer.


### JsonGraph

```ts
interface JsonGraph {
  name:  string;
  nodes: JsonGraphNode[];
  edges: JsonGraphEdge[];
  meta: {
    initialStateId:   string;
    terminalStateIds: string[];
    actionNames:      string[];
    instance?: {
      instanceId:  string;
      version:     number;
      isTerminal:  boolean;
    };
  };
}
```

### JsonGraphNode

```ts
interface JsonGraphNode {
  id:               string;
  kind:             'step' | 'fork' | 'join' | 'wait';
  label:            string;
  isInitial:        boolean;
  isTerminal:       boolean;
  status?:          StateStatus;   // present only when a snapshot is provided
  targets?:         string[];      // ForkState only
  join?: {
    requires: string[];
    mode:     string | number;
  };                               // JoinState only
  externalName?: string;           // WaitState only
}
```

### JsonGraphEdge

```ts
interface JsonGraphEdge {
  id:       string;   // "{from}__{action}__{to}__{index}"
  from:     string;
  to:       string;
  action:   string;
  hasGuard: boolean;
}
```


## Getting the definition

Both exporters require a `WorkflowDefinition` object, obtained from:

```ts
workflow.getDefinition(): WorkflowDefinition
```

The definition is the immutable compiled representation produced by `WorkflowBuilder.build()`.
