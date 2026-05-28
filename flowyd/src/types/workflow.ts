import type { ZodSchema } from 'zod';
import type { AnyState } from './state.js';
import type { TransitionDefinition } from './transition.js';

/**
 * Maps action names to their validated payload types.
 * Built up incrementally by `WorkflowBuilder.defineAction()`.
 */
export type ActionPayloadMap = Record<string, unknown>;

/**
 * Compiled, immutable representation of a workflow definition.
 *
 * The engine and visualisation layer use the default `WorkflowDefinition`
 * (= `WorkflowDefinition<unknown>`) which is effectively type-erased.
 * `Workflow<TActions, TContext>` and `WorkflowInstance<TActions, TContext>`
 * hold `WorkflowDefinition<TContext>` so that `contextSchema.parse()` returns
 * `TContext` directly rather than `unknown`, removing the need for boundary casts.
 *
 * @template TContext - Context type declared via `WorkflowBuilder.setContext()`.
 *                      Defaults to `unknown` for the type-erased engine/vis layer.
 */
export interface WorkflowDefinition<TContext = unknown> {
  readonly name: string;

  /** All states in the graph, keyed by state ID. */
  readonly states: ReadonlyMap<string, AnyState>;

  /** All declared transitions. */
  readonly transitions: readonly TransitionDefinition[];

  /**
   * Zod schemas for each action's payload, keyed by action name.
   * Used by the engine to validate payloads before passing them to guards.
   */
  readonly actionSchemas: ReadonlyMap<string, ZodSchema<unknown>>;

  /** ID of the single state that is `active` when an instance is first created. */
  readonly initialStateId: string;

  /**
   * IDs of terminal states. Once any of these becomes `active`, the instance
   * is considered finished and further `dispatch` calls are rejected.
   */
  readonly terminalStateIds: readonly string[];

  /**
   * Zod schema for the instance context declared via `WorkflowBuilder.setContext()`.
   * Typed as `ZodSchema<TContext>` so `.parse()` returns `TContext` without a cast.
   * `undefined` when no context schema was declared.
   */
  readonly contextSchema?: ZodSchema<TContext>;
}
