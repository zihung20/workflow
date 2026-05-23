import type { ZodSchema } from 'zod';
import type { IState } from './state.js';
import type { TransitionDefinition } from './transition.js';

/**
 * Maps action names to their validated payload types.
 * Built up incrementally by `WorkflowBuilder.defineAction()`.
 */
export type ActionPayloadMap = Record<string, unknown>;

/**
 * Internal, type-erased representation of a compiled workflow.
 *
 * This is the structure the engine and visualisation layer operate against.
 * It carries no generic type parameters — those live on `Workflow<TActions>`
 * and `WorkflowInstance<TActions>` in the core layer where user-facing type
 * safety is enforced.
 */
export interface WorkflowDefinition {
  readonly name: string;

  /** All states in the graph, keyed by state ID. */
  readonly states: ReadonlyMap<string, IState>;

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
}
