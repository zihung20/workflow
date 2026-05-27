import { type ZodSchema } from 'zod';
import type {
  TransitionDefinition,
  ActionPayloadMap,
  WorkflowDefinition,
  IGuard,
  GuardFn,
} from '../types/index.js';
import type { JoinMode } from '../types/state.js';
import { StateKind } from '../types/index.js';
import { StateRegistry } from './registry.js';
import { Workflow } from './workflow.js';
import { FnGuard } from '../guards/index.js';
import { StepState } from '../states/step-state.js';
import { ForkState } from '../states/fork-state.js';
import { JoinState } from '../states/join-state.js';
import { WaitState } from '../states/wait-state.js';

/**
 * Fluent builder for composing and validating a workflow definition.
 *
 * ## Config-First construction
 *
 * Pass all valid state IDs upfront in the constructor. This establishes the
 * `TStates` union at the point of instantiation, so every subsequent call
 * (`addStep`, `addFork`, `addJoin`, `setInitial`, `setTerminal`,
 * `addTransition`) is constrained to that fixed set of names. IDEs will
 * autocomplete state IDs throughout the chain without the caller maintaining a
 * separate type union.
 *
 * ```ts
 * const builder = createWorkflow({
 *   name: 'my-workflow',
 *   states: ['pending', 'fork', 'branch-a', 'branch-b', 'joined', 'done'],
 * });
 * ```
 *
 * ## Typical call order
 *
 * 1. Constructor — declare the name and all state IDs.
 * 2. `defineAction()` — register each action and its Zod payload schema.
 * 3. `addStep()` / `addFork()` / `addJoin()` / `addWait()` — register states.
 * 4. `setInitial()` / `setTerminal()` — declare entry and exit points.
 * 5. `addTransition()` — wire states together with named, optionally-guarded arcs.
 * 6. `build()` — validate and compile into an immutable `Workflow`.
 *
 * `defineAction()` returns a new builder instance so that the `TActions`
 * generic accumulates correctly across calls. All other methods return `this`.
 *
 * `addState()` is an escape hatch for externally-constructed state objects when
 * the typed factory methods are not suitable.
 *
 * @template TActions - Accumulated map of action names → payload types.
 *                      Starts as `Record<never, never>` and grows with each
 *                      `defineAction()` call.
 * @template TStates  - Union of all declared state IDs, inferred from the
 *                      `states` array passed to the constructor. Constrains
 *                      all state-ID arguments throughout the chain.
 */
export class WorkflowBuilder<
  TActions extends ActionPayloadMap = Record<never, never>,
  TStates extends string = never,
> {
  private readonly name: string;
  private readonly stateRegistry = new StateRegistry();
  private readonly transitions: TransitionDefinition[] = [];
  private readonly actionSchemas = new Map<string, ZodSchema<unknown>>();
  private initialStateId: string | null = null;
  private terminalStateIds: string[] = [];

  /**
   * Creates a new `WorkflowBuilder` with the full set of state IDs declared
   * upfront. Prefer the {@link createWorkflow} factory which automatically
   * preserves literal types without needing `as const` at the call site.
   *
   * @param config.name   - Workflow name. Must be non-empty.
   * @param config.states - Array of every state ID in the graph.
   * @throws {Error} If `name` is empty.
   */
  constructor(config: { name: string; states: readonly TStates[] }) {
    if (!config.name.trim()) {
      throw new Error('Workflow name must be non-empty');
    }
    this.name = config.name;
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
   * Creates and registers a `StepState` — the fundamental SOP milestone that
   * waits for an explicit dispatched action before advancing.
   *
   * @param id      - Must be one of the state IDs declared in the constructor.
   * @param options - Optional display label (defaults to `id`).
   * @returns `this` for chaining.
   * @throws {Error} If a state with the same `id` is already registered.
   */
  addStep(id: TStates, options: { label?: string } = {}): this {
    this.stateRegistry.register(new StepState(id, options));
    return this;
  }

  /**
   * Creates and registers a `ForkState` that atomically activates one or more
   * downstream states in parallel when entered.
   *
   * The `targets` array is constrained to `TStates`, so IDEs will autocomplete
   * only the state IDs declared in the constructor.
   *
   * @param id      - Must be one of the state IDs declared in the constructor.
   * @param options - `targets`: non-empty array of state IDs to activate in parallel.
   *                  `label`: optional display label.
   * @returns `this` for chaining.
   * @throws {Error} If `targets` is empty or if the `id` is already registered.
   */
  addFork(id: TStates, options: { label?: string; targets: [TStates, ...TStates[]] }): this {
    this.stateRegistry.register(new ForkState(id, options));
    return this;
  }

  /**
   * Creates and registers a `JoinState` — a synchronisation barrier that
   * becomes `active` automatically once the completion threshold is met.
   *
   * The `requires` array is constrained to `TStates`, so IDEs will autocomplete
   * only the state IDs declared in the constructor.
   *
   * @param id      - Must be one of the state IDs declared in the constructor.
   * @param options - `requires`: non-empty array of prerequisite state IDs.
   *                  `mode`:    `'all'` (default) | `'any'` | a quorum number.
   *                  `label`:   optional display label.
   * @returns `this` for chaining.
   * @throws {Error} If `requires` is empty or if the `id` is already registered.
   */
  addJoin(
    id: TStates,
    options: { label?: string; requires: [TStates, ...TStates[]]; mode?: JoinMode },
  ): this {
    this.stateRegistry.register(new JoinState(id, options));
    return this;
  }

  /**
   * Creates and registers a `WaitState` that pauses the parent workflow until
   * an external signal arrives via `instance.resolveWait(stateId)`.
   *
   * @param id      - Must be one of the state IDs declared in the constructor.
   * @param options - `externalName`: name of the external process being waited on.
   *                  `label`:        optional display label.
   * @returns `this` for chaining.
   * @throws {Error} If a state with the same `id` is already registered.
   */
  addWait(id: TStates, options: { label?: string; externalName: string }): this {
    this.stateRegistry.register(new WaitState(id, options));
    return this;
  }

  /**
   * Declares the single state that will be `active` when a new instance is created.
   *
   * @param stateId - Must be a declared state ID (`TStates`).
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
   * `from` and `to` are constrained to `TStates` — the union of declared state
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
    if (!this.initialStateId) {
      throw new Error('Workflow requires exactly one initial state (call setInitial)');
    }
    if (this.terminalStateIds.length === 0) {
      throw new Error('Workflow requires at least one terminal state (call setTerminal)');
    }

    const states = this.stateRegistry.snapshot();

    if (!states.has(this.initialStateId)) {
      throw new Error(`Initial state "${this.initialStateId}" is not registered`);
    }
    for (const id of this.terminalStateIds) {
      if (!states.has(id)) {
        throw new Error(`Terminal state "${id}" is not registered`);
      }
    }
    for (const t of this.transitions) {
      if (!states.has(t.from)) {
        throw new Error(`Transition from unregistered state "${t.from}"`);
      }
      if (!states.has(t.to)) {
        throw new Error(`Transition to unregistered state "${t.to}"`);
      }
      if (!this.actionSchemas.has(t.on)) {
        throw new Error(
          `Transition uses action "${t.on}" which has no registered schema (call defineAction)`,
        );
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

/**
 * Creates a new {@link WorkflowBuilder} with all state IDs declared upfront.
 *
 * The `const` type parameter modifier automatically infers literal state-ID
 * types from a plain array — no `as const` needed at the call site. When
 * `states` is a runtime `string[]`, TypeScript infers `TStates = string` and
 * the builder falls back to runtime-only validation via `build()`.
 *
 * ```ts
 * // Static: full compile-time safety, no `as const` needed
 * const wf = createWorkflow({ name: 'po', states: ['draft', 'review', 'done'] });
 *
 * // Dynamic: states from a database or user input
 * const wf = createWorkflow({ name: 'dynamic', states: fetchedStates });
 * ```
 *
 * @param config.name   - Workflow name. Must be non-empty.
 * @param config.states - Every state ID in the graph.
 * @returns A `WorkflowBuilder` constrained to the declared state IDs.
 * @throws {Error} If `name` is empty.
 */
export function createWorkflow<const TStates extends string>(config: {
  name: string;
  states: readonly TStates[];
}): WorkflowBuilder<Record<never, never>, TStates> {
  return new WorkflowBuilder<Record<never, never>, TStates>(config);
}
