export type NodeKind = 'step' | 'fork' | 'join' | 'wait';
export type EdgeKind = 'transition' | 'fork-target';

export interface DesignerNode {
  id: string;
  kind: NodeKind;
  label: string;
  isInitial: boolean;
  isTerminal: boolean;
  forkTargets: string[];
  joinRequires: string[];
  joinMode: 'all' | 'any' | number;
  waitExternalName: string;
}

export interface DesignerEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  kind: EdgeKind;
  actionName: string;
  guardBody: string;
}

export interface DesignerWorkflow {
  name: string;
  nodes: DesignerNode[];
  edges: DesignerEdge[];
  /** Zod object body per action name, e.g. `{ amount: z.number(), vendor: z.string() }` */
  actionSchemas: Record<string, string>;
  /** Zod object body for the workflow context, e.g. `{ userId: z.string(), role: z.string() }` */
  contextSchemaBody: string;
}

export type Selection =
  | { type: 'none' }
  | { type: 'node'; id: string }
  | { type: 'edge'; id: string }
  | { type: 'settings' };
