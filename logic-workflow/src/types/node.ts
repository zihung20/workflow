import type { ZodSchema } from 'zod';
import type { ExecutionContext } from '../core/context.js';

/**
 * Discriminant tag identifying the built-in node categories.
 * The engine uses this at runtime to decide routing behaviour (e.g. `IfElse`
 * branches on `true`/`false` ports instead of forwarding its output value).
 */
export enum NodeKind {
  Start   = 'start',
  End     = 'end',
  Static  = 'static',
  Dynamic = 'dynamic',
  And     = 'and',
  Or      = 'or',
  Not     = 'not',
  IfElse  = 'if-else',
}

/**
 * Core contract for every node in a workflow graph.
 *
 * A node is a typed, self-validating unit of computation. Both `TIn` and
 * `TOut` must be fully described by their respective Zod schemas so that
 * boundary validation can be enforced without reflection or casting.
 *
 * @template TIn  - The shape of data this node accepts on its input port.
 * @template TOut - The shape of data this node emits on its output port.
 */
export interface INode<TIn, TOut> {
  /** Unique identifier within the workflow. Must be non-empty. */
  readonly id: string;

  /** Discriminant used by the engine to apply kind-specific routing logic. */
  readonly kind: NodeKind;

  /** Zod schema that guards the input port. Parsed before `execute` is called. */
  readonly inputSchema: ZodSchema<TIn>;

  /** Zod schema that guards the output port. Parsed before the result is forwarded. */
  readonly outputSchema: ZodSchema<TOut>;

  /**
   * Runs the node's logic against a validated input value.
   *
   * @param input - Pre-validated input data matching `inputSchema`.
   * @param ctx   - The shared per-run execution context. Nodes may read from
   *                it but must not write to it — that is exclusively the
   *                engine's responsibility.
   * @returns A promise resolving to the node's output, which will be validated
   *          against `outputSchema` before being forwarded downstream.
   */
  execute(input: TIn, ctx: ExecutionContext): Promise<TOut>;
}

/**
 * Specialisation of `INode` for nodes that route execution along one of two
 * named output ports (`'true'` or `'false'`) based on a boolean result.
 *
 * The original input object — not the boolean — is forwarded to whichever
 * branch is taken, so downstream nodes receive the same data shape as the
 * conditional node's `TIn`.
 *
 * @template TIn - The shape of data evaluated by the condition.
 */
export interface IConditionalNode<TIn> extends INode<TIn, boolean> {
  /** Port name used when the condition evaluates to `true`. Always `'true'`. */
  readonly truePort: 'true';

  /** Port name used when the condition evaluates to `false`. Always `'false'`. */
  readonly falsePort: 'false';
}

/**
 * Type-erased node used internally wherever the engine stores or traverses
 * nodes without knowing their concrete `TIn`/`TOut` shapes.
 *
 * Casting to this type discards generic information intentionally — the
 * engine restores type safety at each boundary by routing values through
 * the node's own `inputSchema` and `outputSchema`.
 */
export type AnyNode = INode<unknown, unknown>;

/**
 * Signature for the user-supplied function that backs a `StaticNode` or
 * `DynamicNode`.
 *
 * @template TIn  - Validated input type guaranteed by `BaseNode.runFn`.
 * @template TOut - Expected output type validated by `BaseNode.runFn` before forwarding.
 * @param input - The Zod-validated input value.
 * @param ctx   - The shared per-run execution context (read-only for nodes).
 * @returns The computed output, synchronously or as a promise.
 */
export type NodeFn<TIn, TOut> = (input: TIn, ctx: ExecutionContext) => TOut | Promise<TOut>;
