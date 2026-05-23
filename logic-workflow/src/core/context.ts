/**
 * Isolated, per-run state container for a single workflow execution.
 *
 * The engine writes port values into the context after each node executes and
 * reads them back when preparing the next node's input. Nodes receive the
 * context as a read-only observer — they must not write to it directly.
 *
 * Port values are keyed by `"nodeId:port"` and stored as `unknown` because
 * the engine operates on type-erased `AnyNode` references. Type safety is
 * restored at each boundary when a node's `inputSchema` parses the retrieved
 * value before it is used.
 */
export class ExecutionContext {
  private readonly store = new Map<string, unknown>();

  /** Ordered record of node IDs that have completed execution in this run. */
  readonly executedNodes: string[] = [];

  /**
   * Stores the output value for a specific port on a node.
   *
   * @param nodeId - The ID of the node that produced the value.
   * @param port   - The output port name (`'output'`, `'true'`, or `'false'`).
   * @param value  - The raw value to store; validated by the receiving node's schema later.
   */
  setPortValue(nodeId: string, port: string, value: unknown): void {
    this.store.set(`${nodeId}:${port}`, value);
  }

  /**
   * Retrieves the stored value for a specific port on a node.
   *
   * @param nodeId - The ID of the node that owns the port.
   * @param port   - The port name to look up.
   * @returns The stored value, or `undefined` if the port has not been written yet.
   */
  getPortValue(nodeId: string, port: string): unknown {
    return this.store.get(`${nodeId}:${port}`);
  }

  /**
   * Reports whether a value has been written to a specific port.
   *
   * Used by the engine to detect whether a node was reached in the current
   * execution path — nodes whose input port has no value were on a branch
   * not taken and must be skipped.
   *
   * @param nodeId - The ID of the node to check.
   * @param port   - The port name to check.
   * @returns `true` if a value has been set for this port in this run.
   */
  hasPortValue(nodeId: string, port: string): boolean {
    return this.store.has(`${nodeId}:${port}`);
  }

  /**
   * Records that a node has finished executing, appending its ID to the
   * ordered execution log.
   *
   * @param nodeId - The ID of the node that just completed.
   */
  recordExecution(nodeId: string): void {
    this.executedNodes.push(nodeId);
  }
}
