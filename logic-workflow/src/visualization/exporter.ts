import type { WorkflowDefinition, InstanceSnapshot } from '../types/index.js';

/**
 * Common contract for all workflow visualisation exporters.
 *
 * An exporter is a pure, stateless transformer. It must not execute
 * workflows, mutate definitions, or hold any runtime state. The optional
 * `snapshot` parameter allows exporters to overlay live instance state
 * (e.g. highlighting currently active or completed states).
 *
 * @template TResult - The output format produced by this exporter.
 */
export interface IExporter<TResult> {
  /**
   * Converts a workflow definition (and optionally a live snapshot) into the
   * exporter's target format.
   *
   * @param definition - The immutable compiled workflow graph.
   * @param snapshot   - Optional live instance snapshot used to annotate
   *                     state statuses in the output.
   */
  export(definition: WorkflowDefinition, snapshot?: InstanceSnapshot): TResult;
}
