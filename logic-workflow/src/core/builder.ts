import { type ZodSchema } from 'zod';
import type { IState, TransitionDefinition, ActionPayloadMap, WorkflowDefinition } from '../types/index.js';
import { StateKind } from '../types/index.js';
import { StateRegistry } from './registry.js';
import { Workflow } from './workflow.js';

/**
 * Fluent builder for composing and validating a workflow definition.
 *
 * Call order:
 * 1. `defineAction()` — register each action and its Zod payload schema.
 * 2. `addState()` — register every state in the graph.
 * 3. `setInitial()` / `setTerminal()` — declare entry and exit points.
 * 4. `addTransition()` — wire states together with named, optionally-guarded arcs.
 * 5. `build()` — validate and compile into an immutable `Workflow`.
 *
 * Every method except `build()` and `defineAction()` returns `this` for chaining.
 * `defineAction()` returns a new builder type so that the `TActions` generic
 * accumulates correctly across calls.
 *
 * @template TActions - Accumulated map of action names → payload types.
 *                      Starts as `Record<never, never>` and grows with each
 *                      `defineAction()` call.
 */
export class WorkflowBuilder<TActions extends ActionPayloadMap = Record<never, never>> {
  private readonly stateRegistry = new StateRegistry();
  private readonly transitions: TransitionDefinition[] = [];
  private readonly actionSchemas = new Map<string, ZodSchema<unknown>>();
  private initialStateId: string | null = null;
  private terminalStateIds: string[] = [];

  constructor(private readonly name: string) {
    if (!name.trim()) throw new Error('Workflow name must be non-empty');
  }

  /**
   * Registers a named action and its Zod payload schema.
   *
   * This call accumulates the `TActions` generic — the returned builder has
   * a more specific type that includes the new action, enabling fully typed
   * `dispatch` and `canExecute` calls on the resulting instance.
   *
   * Must be called before any `addTransition` that uses this action name.
   *
   * @param name   - The action identifier (e.g. `'APPROVE'`, `'SUBMIT'`).
   * @param schema - Zod schema for the payload. Validated at `dispatch` time.
   * @returns A new `WorkflowBuilder` generic extended with the new action.
   */
  defineAction<K extends string, T>(
    name: K,
    schema: ZodSchema<T>,
  ): WorkflowBuilder<TActions & Record<K, T>> {
    this.actionSchemas.set(name, schema as ZodSchema<unknown>);
    return this as unknown as WorkflowBuilder<TActions & Record<K, T>>;
  }

  /**
   * Registers a state in the workflow graph.
   *
   * Accepts any concrete state class: `StepState`, `ForkState`, `JoinState`,
   * or `SubWorkflowState`. The state's `kind` is used by the engine to select
   * the correct entry behaviour.
   *
   * @param state - A state instance with a unique `id`.
   * @throws {Error} If a state with the same `id` is already registered.
   */
  addState(state: IState): this {
    this.stateRegistry.register(state);
    return this;
  }

  /**
   * Declares the single state that will be `active` when a new instance is created.
   *
   * @param stateId - Must be a registered state ID.
   * @throws {Error} If called more than once.
   */
  setInitial(stateId: string): this {
    if (this.initialStateId !== null) {
      throw new Error(`Initial state is already set to "${this.initialStateId}"`);
    }
    this.initialStateId = stateId;
    return this;
  }

  /**
   * Declares one or more terminal states. Once any terminal state becomes
   * `active`, the instance rejects further `dispatch` calls.
   *
   * @param stateIds - IDs of all terminal states. At least one required.
   */
  setTerminal(stateIds: string[]): this {
    this.terminalStateIds = [...stateIds];
    return this;
  }

  /**
   * Adds a directed transition arc to the workflow graph.
   *
   * The engine evaluates this transition when:
   * - `from` is currently `active`
   * - The dispatched action name matches `on`
   * - The optional `guard` evaluates to `true`
   *
   * Multiple transitions from the same state on the same action are allowed
   * (e.g. to model parallel fan-out or mutually exclusive guards). The engine
   * applies all passing transitions in the order they were added.
   *
   * @param transition - The transition definition. `from`, `to`, and `on` are required.
   */
  addTransition(transition: TransitionDefinition): this {
    this.transitions.push(transition);
    return this;
  }

  /**
   * Validates the workflow structure and returns an immutable `Workflow` instance.
   *
   * Structural checks:
   * - `name` must be non-empty (checked in constructor)
   * - Exactly one initial state must be declared
   * - At least one terminal state must be declared
   * - The initial state must be registered
   * - All terminal state IDs must be registered
   * - All transition `from`/`to` IDs must be registered
   * - All transition `on` action names must have registered schemas
   * - `ForkState.targets` must all be registered states
   * - `JoinState.requires` must all be registered states
   *
   * @returns A compiled `Workflow<TActions>` ready to create instances.
   * @throws {Error} If any structural invariant is violated.
   */
  build(): Workflow<TActions> {
    if (!this.initialStateId) throw new Error('Workflow requires exactly one initial state (call setInitial)');
    if (this.terminalStateIds.length === 0) throw new Error('Workflow requires at least one terminal state (call setTerminal)');

    const states = this.stateRegistry.snapshot();

    if (!states.has(this.initialStateId)) {
      throw new Error(`Initial state "${this.initialStateId}" is not registered`);
    }
    for (const id of this.terminalStateIds) {
      if (!states.has(id)) throw new Error(`Terminal state "${id}" is not registered`);
    }
    for (const t of this.transitions) {
      if (!states.has(t.from)) throw new Error(`Transition from unregistered state "${t.from}"`);
      if (!states.has(t.to)) throw new Error(`Transition to unregistered state "${t.to}"`);
      if (!this.actionSchemas.has(t.on)) {
        throw new Error(`Transition uses action "${t.on}" which has no registered schema (call defineAction)`);
      }
    }
    for (const [id, state] of states) {
      if (state.kind === StateKind.Fork) {
        const fork = state as import('../types/index.js').IForkState;
        for (const target of fork.targets) {
          if (!states.has(target)) {
            throw new Error(`ForkState "${id}" references unregistered target "${target}"`);
          }
        }
      }
      if (state.kind === StateKind.Join) {
        const join = state as import('../types/index.js').IJoinState;
        for (const req of join.requires) {
          if (!states.has(req)) {
            throw new Error(`JoinState "${id}" requires unregistered state "${req}"`);
          }
        }
      }
    }

    const definition: WorkflowDefinition = {
      name: this.name,
      states,
      transitions: [...this.transitions],
      actionSchemas: new Map(this.actionSchemas),
      initialStateId: this.initialStateId,
      terminalStateIds: [...this.terminalStateIds],
    };

    return new Workflow<TActions>(definition);
  }
}
