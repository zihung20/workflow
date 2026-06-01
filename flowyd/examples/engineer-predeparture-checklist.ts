/**
 * Example: Train Engineer Pre-Departure Checklist
 *
 * Three inspection streams run in parallel (mechanical, electrical, safety),
 * each requiring an explicit technician sign-off before the downstream join
 * can activate. Demonstrates the two-state branch pattern:
 *
 *   fork activates "in-progress" states (mechanical, electrical, safety-systems).
 *   Each technician dispatches their check action → transitions to a "done"
 *   state (mech-cleared, etc.) which auto-completes immediately.
 *   The join waits on the "done" states — it activates only after all three
 *   explicit dispatches have been made.
 *
 * Workflow diagram:
 *
 *   reported-for-duty
 *        │ BRIEFING_RECEIVED
 *        ▼
 *   briefed ────START_INSPECTION────▶ inspection-fork ⑂
 *                                    /        |          \
 *                            mechanical   electrical   safety-systems
 *                            │MECH_OK      │ELEC_OK      │SAFETY_OK
 *                            ▼             ▼             ▼
 *                       mech-cleared  elec-cleared  safety-cleared  (auto-complete)
 *                            \             |             /
 *                             ╘═══════ join ⑁ (all) ═══╛
 *                                         │ SIGN_OFF
 *                                    signed-off
 *                                         │ DEPART
 *                                    departed ✓
 *
 * Run with:  npx tsx examples/engineer-predeparture-checklist.ts
 */

import { z } from 'zod';
import { createWorkflow } from '../src/index.js';
import { MermaidExporter } from '../src/visualization/index.js';

// ─── Schema definitions ───────────────────────────────────────────────────────

const BriefingSchema = z.object({
  trainId: z.string(),
  routeCode: z.string(),
  shiftTime: z.string(),
});

const InspectionSchema = z.object({
  technicianId: z.string(),
  notes: z.string().optional(),
});

const SignOffSchema = z.object({
  engineerId: z.string(),
  certifies: z.literal(true),
});

const DepartSchema = z.object({
  platform: z.number().int().min(1),
  scheduledAt: z.string(),
});

// ─── Workflow definition ──────────────────────────────────────────────────────

const engineerChecklist = createWorkflow({
  name: 'engineer-predeparture-checklist',
})
  // ── Actions ──────────────────────────────────────────────────────────────
  .defineAction('BRIEFING_RECEIVED', BriefingSchema)
  .defineAction('START_INSPECTION', z.object({}))
  .defineAction('MECH_OK', InspectionSchema)
  .defineAction('ELEC_OK', InspectionSchema)
  .defineAction('SAFETY_OK', InspectionSchema)
  .defineAction('SIGN_OFF', SignOffSchema)
  .defineAction('DEPART', DepartSchema)

  // ── States ───────────────────────────────────────────────────────────────
  .addStep('reported-for-duty', { label: 'Reported for Duty' })
  .addStep('briefed',           { label: 'Briefed' })

  // done states — auto-complete when entered; registered before the join that requires them
  .addStep('mech-cleared',   { label: 'Mechanical Check Cleared' })
  .addStep('elec-cleared',   { label: 'Electrical Check Cleared' })
  .addStep('safety-cleared', { label: 'Safety Check Cleared' })
  // in-progress states — fork targets; wait for an explicit technician dispatch
  .addStep('mechanical',     { label: 'Mechanical Check' })
  .addStep('electrical',     { label: 'Electrical Check' })
  .addStep('safety-systems', { label: 'Safety Systems Check' })

  .addFork('inspection-fork', {
    label: 'Inspection Fork',
    targets: ['mechanical', 'electrical', 'safety-systems'],
  })
  .addJoin('inspections-joined', {
    label: 'Inspections Complete',
    requires: ['mech-cleared', 'elec-cleared', 'safety-cleared'],
    mode: 'all',
  })

  .addStep('signed-off', { label: 'Signed Off' })
  .addStep('departed',   { label: 'Departed' })

  // ── Graph ─────────────────────────────────────────────────────────────────
  .setInitial('reported-for-duty')
  .setTerminal(['departed'])

  .addTransition({ from: 'reported-for-duty', to: 'briefed',         on: 'BRIEFING_RECEIVED' })
  .addTransition({ from: 'briefed',           to: 'inspection-fork', on: 'START_INSPECTION' })

  // each technician dispatches their check; the done state auto-completes
  .addTransition({ from: 'mechanical',     to: 'mech-cleared',   on: 'MECH_OK' })
  .addTransition({ from: 'electrical',     to: 'elec-cleared',   on: 'ELEC_OK' })
  .addTransition({ from: 'safety-systems', to: 'safety-cleared', on: 'SAFETY_OK' })

  .addTransition({
    from: 'inspections-joined',
    to: 'signed-off',
    on: 'SIGN_OFF',
    guard: (ctx) => ctx.payload.certifies === true,
  })
  .addTransition({ from: 'signed-off', to: 'departed', on: 'DEPART' })

  .build();

// ─── Print diagram ────────────────────────────────────────────────────────────

console.log('=== Pre-Departure Checklist — State Diagram ===\n');
console.log(MermaidExporter.export(engineerChecklist.getDefinition()));
console.log('\n');

// ─── Run the workflow ─────────────────────────────────────────────────────────

async function runChecklist() {
  console.log('=== Running: Train ENG-042, Route NS1, Shift 06:00 ===\n');

  const instance = engineerChecklist.createInstance('ENG-042-20240520-0600');

  // Step 1: Morning briefing
  await instance.dispatch('BRIEFING_RECEIVED', {
    trainId: 'ENG-042',
    routeCode: 'NS1',
    shiftTime: '06:00',
  });
  console.log(`[1] Briefing received — state: ${instance.getCurrentStates()}`);

  // Step 2: Kick off parallel inspections (fork activates 3 in-progress states)
  await instance.dispatch('START_INSPECTION', {});
  console.log(`[2] Inspections started — active: ${instance.getCurrentStates()}`);

  // Step 3–5: Each technician clears their stream (order doesn't matter)
  await instance.dispatch('ELEC_OK', { technicianId: 'ELEC-7', notes: 'All circuits nominal' });
  console.log(`[3] Electrical cleared — active: ${instance.getCurrentStates()}`);

  await instance.dispatch('SAFETY_OK', { technicianId: 'SAFE-3', notes: 'Emergency brakes OK' });
  console.log(`[4] Safety cleared — active: ${instance.getCurrentStates()}`);

  await instance.dispatch('MECH_OK', { technicianId: 'MECH-12', notes: 'Bogie within spec' });
  console.log(`[5] Mechanical cleared — all done states auto-completed → join active: ${instance.getCurrentStates()}`);

  // Step 6: Engineer signs off
  await instance.dispatch('SIGN_OFF', { engineerId: 'ENG-042', certifies: true });
  console.log(`[6] Signed off — state: ${instance.getCurrentStates()}`);

  // Step 7: Depart
  const departResult = await instance.dispatch('DEPART', {
    platform: 3,
    scheduledAt: '2024-05-20T06:00:00+08:00',
  });
  if (departResult.success) {
    console.log(`[7] Departed platform 3 ✓`);
    console.log(`\nWorkflow terminal: ${instance.isTerminal()}`);
    console.log(`History entries: ${instance.getSnapshot().history.length}`);
  }

  // ─── Guard demo ──────────────────────────────────────────────────────────────
  console.log('\n=== Guard demo: sign-off with certifies=false is rejected ===\n');

  const blocked = engineerChecklist.createInstance('ENG-099-demo');
  await blocked.dispatch('BRIEFING_RECEIVED', { trainId: 'ENG-099', routeCode: 'EW2', shiftTime: '14:00' });
  await blocked.dispatch('START_INSPECTION', {});
  await blocked.dispatch('MECH_OK', { technicianId: 'MECH-1' });
  await blocked.dispatch('ELEC_OK',  { technicianId: 'ELEC-1' });
  await blocked.dispatch('SAFETY_OK', { technicianId: 'SAFE-1' });

  try {
    // @ts-expect-error — intentional: simulating a form submission without the checkbox ticked
    const guardResult = await blocked.dispatch('SIGN_OFF', { engineerId: 'ENG-099', certifies: false });
    if (!guardResult.success) {
      console.log(`Sign-off blocked: reason = "${guardResult.reason}"`);
    }
  } catch (err: unknown) {
    console.log(`Zod validation rejected the payload: ${(err as Error).message.split('\n')[0]}`);
  }
}

runChecklist().catch(console.error);
