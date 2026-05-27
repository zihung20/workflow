import { z } from 'zod';
import { createWorkflow, Guard, StateStatus } from 'flowyd';
import type { WorkflowInstance, InstanceSnapshot } from 'flowyd';

// ─── Grid geometry ────────────────────────────────────────────────────────────

export const GRID_ROWS = 5;
export const GRID_COLS = 8;

export function getSectionId(idx: number): string {
  return `S${String(idx + 1).padStart(2, '0')}`;
}

export const SECTION_IDS: string[] = Array.from(
  { length: GRID_ROWS * GRID_COLS },
  (_, i) => getSectionId(i),
);

export function getAdjacent(sectionId: string): string[] {
  const idx = parseInt(sectionId.slice(1), 10) - 1;
  const row = Math.floor(idx / GRID_COLS);
  const col = idx % GRID_COLS;
  const out: string[] = [];
  if (row > 0)               out.push(getSectionId((row - 1) * GRID_COLS + col));
  if (row < GRID_ROWS - 1)   out.push(getSectionId((row + 1) * GRID_COLS + col));
  if (col > 0)               out.push(getSectionId(row * GRID_COLS + col - 1));
  if (col < GRID_COLS - 1)   out.push(getSectionId(row * GRID_COLS + col + 1));
  return out;
}

// ─── Zod action schemas ───────────────────────────────────────────────────────

const RequestIsolationSchema = z.object({
  requestedBy: z.string().min(1),
  reason:      z.string().min(1),
});

const ConfirmIsolationSchema = z.object({
  confirmedBy: z.string().min(1),
  switchRef:   z.string().min(1),
});

const IssueClearanceSchema = z.object({
  clearanceRef: z.string().min(1),
  expiresAt:    z.string().min(1),
});

const StartWorkSchema = z.object({
  teamLead:  z.string().min(1),
  headCount: z.number().int().min(1).max(50),
});

const CompleteWorkSchema = z.object({
  summary: z.string().min(1),
});

const RestorePowerSchema = z.object({
  authorizedBy: z.string().min(1),
});

// ─── Workflow definition ──────────────────────────────────────────────────────
//
// Each electrical section goes through 7 states:
//   idle → isolation-requested → isolated → clearance-issued
//        → work-in-progress → work-completed → power-restored
//
// Two cross-section guards make sections wait for neighbours:
//   neighbors-safe  — blocks CONFIRM_ISOLATION until no adjacent section is still energised
//   neighbors-clear — blocks RESTORE_POWER while any adjacent section has live work

export const ewcrWorkflow = createWorkflow({
  name: 'ewcr-section',
  states: [
    'idle',
    'isolation-requested',
    'isolated',
    'clearance-issued',
    'work-in-progress',
    'work-completed',
    'power-restored',
  ],
})
  .defineAction('REQUEST_ISOLATION', RequestIsolationSchema)
  .defineAction('CONFIRM_ISOLATION', ConfirmIsolationSchema)
  .defineAction('ISSUE_CLEARANCE',   IssueClearanceSchema)
  .defineAction('START_WORK',        StartWorkSchema)
  .defineAction('COMPLETE_WORK',     CompleteWorkSchema)
  .defineAction('RESTORE_POWER',     RestorePowerSchema)

  .addStep('idle',                { label: 'Energized' })
  .addStep('isolation-requested', { label: 'Isolation Requested' })
  .addStep('isolated',            { label: 'Isolated & Earthed' })
  .addStep('clearance-issued',    { label: 'Clearance Issued' })
  .addStep('work-in-progress',    { label: 'Work in Progress' })
  .addStep('work-completed',      { label: 'Work Completed' })
  .addStep('power-restored',      { label: 'Power Restored' })

  .setInitial('idle')
  .setTerminal(['power-restored'])

  .addTransition({ from: 'idle',                to: 'isolation-requested', on: 'REQUEST_ISOLATION' })
  .addTransition({ from: 'isolation-requested', to: 'isolated',            on: 'CONFIRM_ISOLATION',
    guard: Guard.inject('neighbors-safe') })
  .addTransition({ from: 'isolated',            to: 'clearance-issued',    on: 'ISSUE_CLEARANCE' })
  .addTransition({ from: 'clearance-issued',    to: 'work-in-progress',    on: 'START_WORK' })
  .addTransition({ from: 'work-in-progress',    to: 'work-completed',      on: 'COMPLETE_WORK' })
  .addTransition({ from: 'work-completed',      to: 'power-restored',      on: 'RESTORE_POWER',
    guard: Guard.inject('neighbors-clear') })

  .build();

// ─── Types ────────────────────────────────────────────────────────────────────

export type EwcrInstance = WorkflowInstance<{
  REQUEST_ISOLATION: z.infer<typeof RequestIsolationSchema>;
  CONFIRM_ISOLATION: z.infer<typeof ConfirmIsolationSchema>;
  ISSUE_CLEARANCE:   z.infer<typeof IssueClearanceSchema>;
  START_WORK:        z.infer<typeof StartWorkSchema>;
  COMPLETE_WORK:     z.infer<typeof CompleteWorkSchema>;
  RESTORE_POWER:     z.infer<typeof RestorePowerSchema>;
}>;

// ─── Guard wiring ─────────────────────────────────────────────────────────────

function getSnap(inst: EwcrInstance): InstanceSnapshot {
  // WorkflowInstance.getSnapshot() is public — no cast needed.
  // Using a local alias so the guard closures stay readable.
  return (inst as unknown as { getSnapshot(): InstanceSnapshot }).getSnapshot();
}

export function wireAllGuards(instances: Map<string, EwcrInstance>): void {
  for (const [sectionId, instance] of instances) {
    const neighbors = getAdjacent(sectionId);

    // Passes when every adjacent section has left the energised idle state,
    // meaning operators there have at least requested isolation.
    instance.injectGuard('neighbors-safe', (_ctx) => {
      return neighbors.every((nId) => {
        const n = instances.get(nId);
        if (!n) return true;
        // stateStatuses['idle'] === Active means the section is still energised
        return getSnap(n).stateStatuses['idle'] !== StateStatus.Active;
      });
    });

    // Passes when no adjacent section still has live work under clearance.
    instance.injectGuard('neighbors-clear', (_ctx) => {
      return neighbors.every((nId) => {
        const n = instances.get(nId);
        if (!n) return true;
        const ss = getSnap(n).stateStatuses;
        return (
          ss['clearance-issued']  !== StateStatus.Active &&
          ss['work-in-progress']  !== StateStatus.Active
        );
      });
    });
  }
}

export function makeAllInstances(): Map<string, EwcrInstance> {
  const instances = new Map<string, EwcrInstance>();
  for (const id of SECTION_IDS) {
    instances.set(id, ewcrWorkflow.createInstance(id));
  }
  wireAllGuards(instances);
  return instances;
}
