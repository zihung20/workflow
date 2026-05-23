# logic-workflow — Architecture Blueprint

## Layered Design Overview

```
┌─────────────────────────────────────────────────┐
│              Public API (index.ts)               │
├───────────────────┬─────────────────────────────┤
│   Core Layer      │   Visualization Layer        │
│  (engine, builder,│  (MermaidExporter,           │
│   registry, sched)│   JsonGraphExporter)         │
├───────────────────┴─────────────────────────────┤
│              Nodes Layer                         │
│  (StaticNode, DynamicNode, AND, OR, NOT,        │
│   IfElseNode, StartNode, EndNode)               │
├─────────────────────────────────────────────────┤
│              Types + Schemas Layer               │
│  (TypeScript interfaces, Zod schemas)           │
└─────────────────────────────────────────────────┘
```

---

## Folder Structure

```
logic-workflow/
├── src/
│   ├── types/
│   │   ├── workflow.ts       # WorkflowDefinition<TIn, TOut>, Edge, Port
│   │   ├── node.ts           # NodeDefinition<TIn, TOut>, NodeKind enum
│   │   └── index.ts
│   │
│   ├── schemas/
│   │   ├── workflow.schema.ts  # Zod schemas for workflow-level validation
│   │   └── node.schema.ts      # Zod schemas for node I/O validation
│   │
│   ├── nodes/
│   │   ├── base.ts             # INode<TIn, TOut> interface + NodeMeta
│   │   ├── static-node.ts      # StaticNode — wraps a fixed function
│   │   ├── dynamic-node.ts     # DynamicNode — placeholder, injected at runtime
│   │   ├── start.ts            # StartNode — typed workflow entry
│   │   ├── end.ts              # EndNode   — typed workflow exit
│   │   ├── logic/
│   │   │   ├── and.ts          # AndNode(inputs[]) → boolean
│   │   │   ├── or.ts           # OrNode(inputs[])  → boolean
│   │   │   ├── not.ts          # NotNode(input)    → boolean
│   │   │   └── if-else.ts      # IfElseNode — composite: condition → true|false branch
│   │   └── index.ts
│   │
│   ├── core/
│   │   ├── builder.ts          # WorkflowBuilder — fluent chainable API
│   │   ├── engine.ts           # WorkflowEngine.execute() — runs the DAG
│   │   ├── scheduler.ts        # Topological sort + dependency resolution
│   │   ├── registry.ts         # NodeRegistry — name → node lookup
│   │   ├── context.ts          # ExecutionContext — per-run state + port values
│   │   └── index.ts
│   │
│   ├── visualization/
│   │   ├── exporter.ts         # IExporter interface
│   │   ├── mermaid.ts          # MermaidExporter → Mermaid flowchart string
│   │   ├── json-graph.ts       # JsonGraphExporter → { nodes[], edges[] } JSON
│   │   └── index.ts
│   │
│   └── index.ts                # Public barrel export
│
├── tests/
│   ├── core/
│   │   ├── builder.test.ts
│   │   ├── engine.test.ts
│   │   └── scheduler.test.ts
│   ├── nodes/
│   │   ├── static-node.test.ts
│   │   ├── dynamic-node.test.ts
│   │   └── logic/
│   │       ├── and.test.ts
│   │       ├── or.test.ts
│   │       ├── not.test.ts
│   │       └── if-else.test.ts
│   ├── visualization/
│   │   ├── mermaid.test.ts
│   │   └── json-graph.test.ts
│   └── integration/
│       ├── linear-workflow.test.ts
│       └── branching-workflow.test.ts
│
├── examples/
│   ├── basic-workflow.ts
│   ├── branching-workflow.ts
│   └── dynamic-injection.ts
│
├── package.json
├── tsconfig.json
├── tsconfig.build.json   # Strict build config, excludes tests
├── vitest.config.ts
└── .eslintrc.json
```

---

## Key Type Signatures

```typescript
// Types layer — workflow.ts
type WorkflowDefinition<TInput, TOutput> = {
  name: string;
  nodes: Map<string, INode<unknown, unknown>>;
  edges: Edge[];
  inputSchema: ZodSchema<TInput>;
  outputSchema: ZodSchema<TOutput>;
};

type Edge = {
  from: { nodeId: string; port: 'output' | 'true' | 'false' };
  to:   { nodeId: string; port: 'input' };
};

// Node interface — base.ts
interface INode<TIn, TOut> {
  readonly id: string;
  readonly kind: NodeKind;
  inputSchema:  ZodSchema<TIn>;
  outputSchema: ZodSchema<TOut>;
  execute(input: TIn, ctx: ExecutionContext): Promise<TOut>;
}

// IfElseNode has two output ports
interface IConditionalNode<TIn> extends INode<TIn, boolean> {
  truePort:  string;
  falsePort: string;
}
```

---

## API Design (Fluent Builder)

```typescript
import { WorkflowBuilder, StaticNode, DynamicNode, IfElseNode } from 'logic-workflow';
import { MermaidExporter, JsonGraphExporter } from 'logic-workflow/visualization';
import { z } from 'zod';

// 1. Define schemas
const FetchSchema  = z.object({ userId: z.string() });
const ResultSchema = z.object({ data: z.any(), isValid: z.boolean() });

// 2. Build the workflow
const workflow = new WorkflowBuilder('user-pipeline', FetchSchema, ResultSchema)
  .addNode('fetch',    StaticNode.from(fetchFn,   { input: FetchSchema,   output: DataSchema }))
  .addNode('validate', DynamicNode.placeholder(   { input: DataSchema,    output: ResultSchema }))
  .addNode('branch',   new IfElseNode(            { condition: (r) => r.isValid }))
  .connect('fetch',    'validate')
  .connect('validate', 'branch')
  .onTrue ('branch',   'successEnd')
  .onFalse('branch',   'failureEnd')
  .build();

// 3. Inject dynamic node at runtime
workflow.inject('validate', myRuntimeValidationFn);

// 4. Execute (fully typed input/output)
const result = await workflow.execute({ userId: 'abc-123' });

// 5. Visualize
const mermaidStr = MermaidExporter.export(workflow);  // → "flowchart TD\n  ..."
const jsonGraph  = JsonGraphExporter.export(workflow); // → { nodes: [...], edges: [...] }
```

---

## Logic Gate Semantics

| Node | Inputs | Output | Notes |
|------|--------|--------|-------|
| `AndNode` | `boolean[]` | `boolean` | All must be true |
| `OrNode` | `boolean[]` | `boolean` | At least one true |
| `NotNode` | `boolean` | `boolean` | Inverts |
| `IfElseNode` | `T` + `condition: (T) => boolean` | routes to `true`/`false` port | Composite built on AND/OR/NOT primitives |

---

## Dependency List

### Runtime (`dependencies`)

| Package | Purpose |
|---------|---------|
| `zod` | Runtime schema validation + type inference |

### Development only (`devDependencies`)

| Package | Purpose |
|---------|---------|
| `typescript` | Type system |
| `tsup` | Dual ESM + CJS build (zero-config) |
| `vitest` | Fast test runner with native TS support |
| `@types/node` | Node.js type definitions |
| `eslint` | Linting |
| `@typescript-eslint/parser` | TS-aware linting |
| `@typescript-eslint/eslint-plugin` | TS lint rules |

> Visualization has **zero runtime dependencies** — Mermaid output is pure string construction;
> JSON graph is a plain object. Users plug the output into whatever renderer they want
> (Mermaid CLI, React-Flow, Cytoscape, etc.).

---

## Build Output

```
dist/
├── index.js          # CJS
├── index.mjs         # ESM
├── index.d.ts        # Type declarations
└── visualization/
    ├── index.js
    ├── index.mjs
    └── index.d.ts
```

---

## Implementation Steps

1. **Scaffold** — `package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`
2. **Types + Schemas** — All interfaces, enums, and Zod schemas (no logic yet)
3. **Node Implementations** — `BaseNode`, `StaticNode`, `DynamicNode`, then logic gates
4. **Core Engine** — `WorkflowBuilder`, `WorkflowEngine`, `Scheduler` (topological sort), `ExecutionContext`
5. **Visualization** — `IExporter`, `MermaidExporter`, `JsonGraphExporter`
6. **Tests** — Unit tests per module, integration tests for linear + branching workflows
7. **Examples** — Three runnable examples covering each major feature
8. **Build verification** — `tsup` build, type-check, full test pass