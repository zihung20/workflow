/**
 * Type-safe wrapper around `Object.entries` for records with a known key union.
 *
 * `Object.entries` always returns `[string, V][]`; this function narrows the key
 * to `K` in one audited place so call sites remain cast-free. The cast is safe
 * because TypeScript's structural type system cannot express "closed" object types —
 * any `Record<K, V>` we construct exclusively from registered keys satisfies the
 * invariant at runtime.
 *
 * @param obj - A record whose keys are the literal union `K`.
 * @returns An array of `[K, V]` tuples — identical to `Object.entries` at runtime.
 */
export function typedEntries<K extends string, V>(obj: Readonly<Record<K, V>>): [K, V][] {
  return Object.entries(obj) as [K, V][];
}

/**
 * Type-safe wrapper around `Object.fromEntries` for iterables with a known key union.
 *
 * `Object.fromEntries` always returns `Record<string, V>`; this function narrows the
 * key to `K` in one audited place so call sites remain cast-free. The cast is safe
 * for the same reason as `typedEntries` — TypeScript has no "closed" object type.
 *
 * @param entries - An iterable of `[K, V]` pairs (e.g. a `Map<K, V>`).
 * @returns A `Record<K, V>` — identical to `Object.fromEntries` at runtime.
 */
export function typedFromEntries<K extends string, V>(entries: Iterable<readonly [K, V]>): Record<K, V> {
  return Object.fromEntries(entries) as Record<K, V>;
}
