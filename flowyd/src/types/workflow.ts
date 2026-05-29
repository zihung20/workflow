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
 * `WorkflowDefinition` (= `WorkflowDefinition<unknown, string>`) is the
 * type-erased form used by the visualisation layer. `Workflow<TActions, TContext, TStates>`
 * and `WorkflowInstance<TActions, TContext, TStates>` hold
 * `WorkflowDefinition<TContext, TStates>` so the engine returns a fully typed
 * `DispatchResult` without any boundary cast at the instance level.
 *
 * @template TContext - Context type declared via `WorkflowBuilder.setContext()`.
 *                      Defaults to `unknown` for the type-erased vis layer.
 * @template TStates  - Union of registered state IDs. Defaults to `string` for
 *                      the type-erased engine/vis layer.
 */
export interface WorkflowDefinition<TContext = unknown, TStates extends string = string> {
  readonly name: string;

  /** All states in the graph, keyed by state ID. */
  readonly states: ReadonlyMap<TStates, AnyState>;

  /** All declared transitions. */
  readonly transitions: readonly TransitionDefinition<TStates>[];

  /**
   * Zod schemas for each action's payload, keyed by action name.
   * Used by the engine to validate payloads before passing them to guards.
   */
  readonly actionSchemas: ReadonlyMap<string, ZodSchema<unknown>>;

  /** ID of the single state that is `active` when an instance is first created. */
  readonly initialStateId: TStates;

  /**
   * IDs of terminal states. Once any of these becomes `active`, the instance
   * is considered finished and further `dispatch` calls are rejected.
   */
  readonly terminalStateIds: readonly TStates[];

  /**
   * Zod schema for the instance context declared via `WorkflowBuilder.setContext()`.
   * Typed as `ZodSchema<TContext>` so `.parse()` returns `TContext` without a cast.
   * `undefined` when no context schema was declared.
   */
  readonly contextSchema?: ZodSchema<TContext>;
}
