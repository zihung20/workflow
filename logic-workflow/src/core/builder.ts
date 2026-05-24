import { type ZodSchema } from 'zod';
import type { AnyState, TransitionDefinition, ActionPayloadMap, WorkflowDefinition, IGuard, GuardFn } from '../types/index.js';
import { StateKind } from '../types/index.js';
import { StateRegistry } from './registry.js';
import { Workflow } from './workflow.js';
import { FnGuard } from '../guards/index.js';

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
 * Both `defineAction()` and `addState()` return new builder instances so that
 * the `TActions` and `TStates` generics accumulate correctly across calls.
 * All other methods return `this` for chaining.
 *
 * @template TActions - Accumulated map of action names → payload types.
 *                      Starts as `Record<never, never>` and grows with each
 *                      `defineAction()` call.
 * @template TStates  - Union of all registered state IDs as string literals.
 *                      Starts as `never` and grows with each `addState()` call.
 *                      Constrains `setInitial`, `setTerminal`, and `addTransition`
 *                      to only accept IDs that have been registered.
 */
export class WorkflowBuilder<
  TActions extends ActionPayloadMap = Record<never, never>,
  TStates extends string = never,
> {
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
  ): WorkflowBuilder<TActions & Record<K, T>, TStates> {
    this.actionSchemas.set(name, schema as ZodSchema<unknown>);
    // Builder identity preserved; only the TActions generic parameter changes.
    return this as unknown as WorkflowBuilder<TActions & Record<K, T>, TStates>;
  }

  /**
   * Registers a state in the workflow graph and extends the compile-time union
   * of known state IDs (`TStates`).
   *
   * Accepts any concrete state class: `StepState`, `ForkState`, `JoinState`,
   * or `SubWorkflowState`. The state's `kind` is used by the engine to select
   * the correct entry behaviour.
   *
   * @param state - A state instance with a unique `id`.
   * @returns A new `WorkflowBuilder` generic extended with the new state ID.
   * @throws {Error} If a state with the same `id` is already registered.
   */
  addState<S extends AnyState>(state: S): WorkflowBuilder<TActions, TStates | S['id']> {
    this.stateRegistry.register(state);
    // Builder identity preserved; the TStates ID union grows.
    return this as unknown as WorkflowBuilder<TActions, TStates | S['id']>;
  }

  /**
   * Declares the single state that will be `active` when a new instance is created.
   *
   * @param stateId - Must be a registered state ID (`TStates`).
   * @throws {Error} If called more than once.
   */
  setInitial(stateId: TStates): this {
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
   * @param stateIds - IDs of all terminal states (`TStates`). At least one required.
   */
  setTerminal(stateIds: ReadonlyArray<TStates>): this {
    this.terminalStateIds = [...stateIds];
    return this;
  }

  /**
   * Adds a directed transition arc to the workflow graph.
   *
   * `from` and `to` are constrained to `TStates` — the union of registered state
   * IDs — and `on` is constrained to `keyof TActions`, preventing typos at
   * compile time for both state IDs and action names.
   *
   * The `guard` property accepts either:
   * - A raw arrow function `(ctx) => boolean | Promise<boolean>`: `ctx.payload`
   *   is automatically typed as `TActions[K]`, eliminating the need for an
   *   explicit type annotation.
   * - Any `IGuard` instance (e.g. `Guard.and([...])`, `Guard.inject('name')`).
   * Raw functions are wrapped in `FnGuard` internally; the engine sees only `IGuard`.
   *
   * Multiple transitions from the same state on the same action are allowed
   * (e.g. to model parallel fan-out or mutually exclusive guards). The engine
   * applies all passing transitions in the order they were added.
   *
   * @param transition - The transition definition. `from`, `to`, and `on` are required.
   */
  addTransition<K extends keyof TActions & string>(transition: {
    readonly from: TStates;
    readonly to: TStates;
    readonly on: K;
    readonly guard?: IGuard<TActions[K]> | GuardFn<TActions[K]>;
  }): this {
    const guard: IGuard<unknown> | undefined =
      transition.guard === undefined
        ? undefined
        : typeof transition.guard === 'function'
          ? new FnGuard(transition.guard as GuardFn<unknown>)
          : // IGuard method signatures are bivariant; safe because the engine passes
            // the runtime-validated payload whose type matches TActions[K].
            (transition.guard as IGuard<unknown>);

    // exactOptionalPropertyTypes requires the property to be absent rather than
    // set to `undefined`, so we conditionally include `guard`.
    const entry: TransitionDefinition =
      guard !== undefined
        ? { from: transition.from, to: transition.to, on: transition.on, guard }
        : { from: transition.from, to: transition.to, on: transition.on };

    this.transitions.push(entry);
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
        for (const target of state.targets) {
          if (!states.has(target)) {
            throw new Error(`ForkState "${id}" references unregistered target "${target}"`);
          }
        }
      }
      if (state.kind === StateKind.Join) {
        for (const req of state.requires) {
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
