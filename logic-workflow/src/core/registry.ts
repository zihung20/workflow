import type { AnyState } from '../types/index.js';
import type { GuardFn } from '../types/index.js';

/**
 * Mutable store for all states registered during the build phase.
 *
 * Owned by `WorkflowBuilder` and sealed into the `WorkflowDefinition` at
 * `build()` time via `snapshot()`.
 */
export class StateRegistry {
  private readonly states = new Map<string, AnyState>();

  /**
   * Adds a state to the registry.
   *
   * @param state - The state to register. Its `id` must be unique.
   * @throws {Error} If a state with the same `id` is already registered.
   */
  register(state: AnyState): void {
    if (this.states.has(state.id)) {
      throw new Error(`State with id "${state.id}" is already registered`);
    }
    this.states.set(state.id, state);
  }

  /**
   * Retrieves a state by ID.
   *
   * @param id - The state's unique identifier.
   * @throws {Error} If no state with this ID has been registered.
   */
  get(id: string): AnyState {
    const state = this.states.get(id);
    if (!state) throw new Error(`State "${id}" is not registered`);
    return state;
  }

  has(id: string): boolean {
    return this.states.has(id);
  }

  /**
   * Returns an immutable snapshot of all currently registered states.
   * Called by `WorkflowBuilder.build()` to freeze the state map.
   */
  snapshot(): ReadonlyMap<string, AnyState> {
    return new Map(this.states);
  }
}

/**
 * Per-instance registry mapping guard names to their injected implementations.
 *
 * Owned by `WorkflowInstance` and populated via `instance.injectGuard()`.
 * The engine uses `resolve()` when building the `GuardContext` passed to
 * `InjectedGuard.evaluate()`.
 */
export class GuardRegistry {
  private readonly guards = new Map<string, GuardFn<unknown>>();

  /**
   * Registers a named guard implementation.
   * Overwrites any previously registered function for the same name.
   *
   * @param name - The registry key. Must match the name used in `Guard.inject('name')`.
   * @param fn   - The guard function. Annotate the generic `TPayload` at the
   *               call site to ensure the function receives the correct payload type.
   */
  register<TPayload>(name: string, fn: GuardFn<TPayload>): void {
    this.guards.set(name, fn as GuardFn<unknown>);
  }

  /**
   * Looks up a guard function by name.
   *
   * @param name - The registry key to look up.
   * @returns The registered function, or `undefined` if not yet injected.
   */
  resolve(name: string): GuardFn<unknown> | undefined {
    return this.guards.get(name);
  }
}
