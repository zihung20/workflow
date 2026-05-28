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
 * ## Accumulating-Builder construction
 *
 * Call `createWorkflow({ name })` to start. Each call to `addStep`, `addFork`,
 * `addJoin`, or `addWait` widens the `TStates` union by one literal, so every
 * subsequent call is constrained to the growing set of registered IDs — no
 * upfront array needed. IDEs autocomplete state IDs as they are registered.
 *
 * ```ts
 * const builder = createWorkflow({ name: 'my-workflow' })
 *   .addStep('pending')
 *   .addStep('branch-a')
 *   .addStep('branch-b')
 *   .addFork('fork', { targets: ['branch-a', 'branch-b'] })
 *   .addStep('joined')
 *   .addStep('done');
 * ```
 *
 * **Ordering rule for fork/join:** `addFork.targets` and `addJoin.requires` are
 * constrained to states already in `TStates`. Register branch/prerequisite
 * states before the fork or join that references them.
 *
 * ## Typical call order
 *
 * 1. `createWorkflow({ name })` — start the builder.
 * 2. `defineAction()` — register each action and its Zod payload schema.
 * 3. `addStep()` / `addFork()` / `addJoin()` / `addWait()` — register states (branches before forks/joins).
 * 4. `setInitial()` / `setTerminal()` — declare entry and exit points.
 * 5. `addTransition()` — wire states together with named, optionally-guarded arcs.
 * 6. `build()` — validate and compile into an immutable `Workflow`.
 *
 * `defineAction()` and the four state-registration methods return the same
 * builder instance under a widened type — `TActions` and `TStates` accumulate
 * correctly without allocating a new object.
 * `setInitial`, `setTerminal`, and `addTransition` return `this`.
 *
 * @template TActions  - Accumulated map of action names → payload types.
 *                       Starts as `Record<never, never>` and grows with each
 *                       `defineAction()` call.
 * @template TStates   - Union of registered state IDs. Starts as `never` and
 *                       widens with each `addStep`/`addFork`/`addJoin`/`addWait`
 *                       call. Constrains all state-ID arguments throughout the chain.
 * @template TContext  - Type of the instance context declared via `setContext()`.
 *                       Defaults to `unknown` until `setContext` is called.
 */
export class WorkflowBuilder<
  TActions extends ActionPayloadMap = Record<never, never>,
  TStates extends string = never,
  TContext = unknown,
> {
  private readonly name: string;
  private readonly stateRegistry = new StateRegistry();
  private readonly transitions: TransitionDefinition[] = [];
  private readonly actionSchemas = new Map<string, ZodSchema<unknown>>();
  private initialStateId: string | null = null;
  private terminalStateIds: string[] = [];
  private contextSchema: ZodSchema<unknown> | undefined = undefined;

  /**
   * Creates a new `WorkflowBuilder`. Prefer the {@link createWorkflow} factory
   * which starts with `TStates = never` and accumulates state IDs via the
   * `addStep` / `addFork` / `addJoin` / `addWait` call chain.
   *
   * @param config.name - Workflow name. Must be non-empty.
   * @throws {Error} If `name` is empty.
   */
  constructor(config: { name: string }) {
    if (!config.name.trim()) {
      throw new Error('Workflow name must be non-empty');
    }
    this.name = config.name;
  }

  /**
   * Declares the shape of the instance context, widening `TContext` from
   * `unknown` to the inferred type `C`.
   *
   * The schema is stored on the workflow definition and used to validate
   * context values at `createInstance` and `instance.setContext()` time.
   * It also types `ctx.context` in inline guards on `addTransition`.
   *
   * The initial context value is provided per-instance at `createInstance` time,
   * not here — different instances of the same workflow may start with different
   * context values.
   *
   * ```ts
   * const wf = createWorkflow({ name: 'approval' })
   *   .setContext(z.object({ score: z.number(), isDutyManager: z.boolean() }))
   *   .addTransition({
   *     from: 'review', to: 'approved', on: 'APPROVE',
   *     guard: (ctx) => ctx.context.isDutyManager && ctx.context.score >= 80,
   *   })
   *   .build();
   *
   * const instance = wf.createInstance('req-001', { score: 92, isDutyManager: true });
   * ```
   *
   * @param schema - Zod schema describing the context shape. Stored for runtime
   *                 validation and used to infer `C`.
   * @returns The same builder with `TContext` set to `C`.
   */
  setContext<C>(schema: ZodSchema<C>): WorkflowBuilder<TActions, TStates, C> {
    this.contextSchema = schema;
    // TContext and C are unrelated type parameters; double cast is required.
    return this as unknown as WorkflowBuilder<TActions, TStates, C>;
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
   * @returns The same builder with `TActions` extended to include the new action.
   */
  defineAction<K extends string, T>(
    name: K,
    schema: ZodSchema<T>,
  ): WorkflowBuilder<TActions & Record<K, T>, TStates, TContext> {
    this.actionSchemas.set(name, schema);
    return this as WorkflowBuilder<TActions & Record<K, T>, TStates, TContext>;
  }

  /**
   * Creates and registers a `StepState` — the fundamental SOP milestone that
   * waits for an explicit dispatched action before advancing.
   *
   * Widens the `TStates` generic to include `K`, making `id` available as a
   * valid target in subsequent `setInitial`, `setTerminal`, `addTransition`,
   * `addFork.targets`, and `addJoin.requires` calls.
   *
   * @param id      - Unique state identifier. Becomes part of `TStates` after this call.
   * @param options - Optional display label (defaults to `id`).
   * @returns The same builder with `TStates` widened to `TStates | K`.
   * @throws {Error} If a state with the same `id` is already registered.
   */
  addStep<K extends string>(id: K, options: { label?: string } = {}): WorkflowBuilder<TActions, TStates | K, TContext> {
    this.stateRegistry.register(new StepState(id, options));
    return this as WorkflowBuilder<TActions, TStates | K, TContext>;
  }

  /**
   * Creates and registers a `ForkState` that atomically activates one or more
   * downstream states in parallel when entered.
   *
   * `targets` is constrained to `TStates` (states already registered via
   * `addStep`/`addFork`/`addJoin`/`addWait`). Register all branch states before
   * calling `addFork` — unregistered IDs are compile-time errors.
   *
   * @param id      - Unique state identifier for the fork node.
   * @param options - `targets`: non-empty array of already-registered state IDs to activate in parallel.
   *                  `label`: optional display label.
   * @returns The same builder with `TStates` widened to `TStates | K`.
   * @throws {Error} If `targets` is empty or if the `id` is already registered.
   */
  addFork<K extends string>(
    id: K,
    options: { label?: string; targets: [TStates, ...TStates[]] },
  ): WorkflowBuilder<TActions, TStates | K, TContext> {
    this.stateRegistry.register(new ForkState(id, options));
    return this as WorkflowBuilder<TActions, TStates | K, TContext>;
  }

  /**
   * Creates and registers a `JoinState` — a synchronisation barrier that
   * becomes `active` automatically once the completion threshold is met.
   *
   * `requires` is constrained to `TStates` (states already registered via
   * `addStep`/`addFork`/`addJoin`/`addWait`). Register all prerequisite states
   * before calling `addJoin` — unregistered IDs are compile-time errors.
   *
   * @param id      - Unique state identifier for the join node.
   * @param options - `requires`: non-empty array of already-registered prerequisite state IDs.
   *                  `mode`:    `'all'` (default) | `'any'` | a quorum number.
   *                  `label`:   optional display label.
   * @returns The same builder with `TStates` widened to `TStates | K`.
   * @throws {Error} If `requires` is empty or if the `id` is already registered.
   */
  addJoin<K extends string>(
    id: K,
    options: { label?: string; requires: [TStates, ...TStates[]]; mode?: JoinMode },
  ): WorkflowBuilder<TActions, TStates | K, TContext> {
    this.stateRegistry.register(new JoinState(id, options));
    return this as WorkflowBuilder<TActions, TStates | K, TContext>;
  }

  /**
   * Creates and registers a `WaitState` that pauses the parent workflow until
   * an external signal arrives via `instance.resolveWait(stateId)`.
   *
   * @param id      - Unique state identifier for the wait node.
   * @param options - `externalName`: name of the external process being waited on.
   *                  `label`:        optional display label.
   * @returns The same builder with `TStates` widened to `TStates | K`.
   * @throws {Error} If a state with the same `id` is already registered.
   */
  addWait<K extends string>(
    id: K,
    options: { label?: string; externalName: string },
  ): WorkflowBuilder<TActions, TStates | K, TContext> {
    this.stateRegistry.register(new WaitState(id, options));
    return this as WorkflowBuilder<TActions, TStates | K, TContext>;
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
    readonly guard?: IGuard<TActions[K]> | GuardFn<TActions[K], TContext>;
  }): this {
    const guard: IGuard<unknown> | undefined =
      transition.guard === undefined
        ? undefined
        : typeof transition.guard === 'function'
          ? new FnGuard(transition.guard)
          : transition.guard;

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
   * @returns A compiled `Workflow<TActions, TContext>` ready to create instances.
   * @throws {Error} If any structural invariant is violated.
   */
  build(): Workflow<TActions, TContext> {
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

    // contextSchema is stored as ZodSchema<unknown> because the builder accumulates
    // TContext via setContext<C>() which casts `this` to a new type. At build() time
    // TContext is sealed, so casting the stored schema to ZodSchema<TContext> is safe.
    const definition: WorkflowDefinition<TContext> = {
      name: this.name,
      states,
      transitions: [...this.transitions],
      actionSchemas: new Map(this.actionSchemas),
      initialStateId: this.initialStateId,
      terminalStateIds: [...this.terminalStateIds],
      ...(this.contextSchema !== undefined && {
        contextSchema: this.contextSchema as ZodSchema<TContext>,
      }),
    };

    return new Workflow<TActions, TContext>(definition);
  }
}

/**
 * Creates a new {@link WorkflowBuilder} with `TStates` starting as `never`.
 *
 * Each call to `addStep`, `addFork`, `addJoin`, or `addWait` widens `TStates`
 * by one literal, so all subsequent calls are constrained to the growing set
 * of registered IDs — no upfront array needed.
 *
 * ```ts
 * const wf = createWorkflow({ name: 'po' })
 *   .addStep('draft')
 *   .addStep('review')
 *   .addStep('done')
 *   .setInitial('draft')
 *   .setTerminal(['done'])
 *   .build();
 * ```
 *
 * For workflows whose state IDs are only known at runtime, use
 * {@link createDynamicWorkflow} instead.
 *
 * @param config.name - Workflow name. Must be non-empty.
 * @returns A `WorkflowBuilder` with `TStates = never`, ready to accumulate state IDs.
 * @throws {Error} If `name` is empty.
 */
export function createWorkflow(config: {
  name: string;
}): WorkflowBuilder<Record<never, never>, never> {
  return new WorkflowBuilder<Record<never, never>, never>(config);
}

/**
 * Creates a {@link WorkflowBuilder} typed for runtime-defined state IDs.
 *
 * Use this when state IDs come from an external source (database, config file,
 * user input) and cannot be known at compile time. Unlike {@link createWorkflow},
 * `TStates` is pre-widened to `string` so you can call `addStep`, `addFork`,
 * `addJoin`, and `addWait` in loops without type errors. Structural correctness
 * is enforced at runtime by `build()`.
 *
 * ```ts
 * const builder = createDynamicWorkflow({ name: 'dynamic-linear' });
 * builder.defineAction('NEXT', z.object({}));
 * for (const id of fetchedIds) { builder.addStep(id); }
 * builder.setInitial(fetchedIds[0]).setTerminal([fetchedIds.at(-1)]);
 * const wf = builder.build();
 * ```
 *
 * @param config.name - Workflow name. Must be non-empty.
 * @returns A `WorkflowBuilder` with `TStates = string` and `TActions = Record<string, unknown>`.
 * @throws {Error} If `name` is empty.
 */
export function createDynamicWorkflow(config: {
  name: string;
}): WorkflowBuilder<Record<string, unknown>, string> {
  return new WorkflowBuilder<Record<string, unknown>, string>(config);
}
