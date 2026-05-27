/**
 * Example: Train Engineer Pre-Departure Checklist
 *
 * Demonstrates the Config-First WorkflowBuilder pattern. All state names are
 * declared upfront in the constructor so that `addFork` targets and `addJoin`
 * requires receive IDE autocomplete restricted to the declared union — no
 * manual type unions needed.
 *
 * Three inspection streams run in parallel (mechanical, electrical, safety),
 * then join before the engineer can sign off and depart.
 *
 * Workflow diagram:
 *
 *   reported-for-duty
 *        │ BRIEFING_RECEIVED
 *        ▼
 *   briefed ────────────── START_INSPECTION ──────────────▶ inspection-fork ⑂
 *                                                          /        |         \
 *                                               mechanical   electrical   safety-systems
 *                                                    │             │              │
 *                                            MECH_OK      ELEC_OK         SAFETY_OK
 *                                                    \             |              /
 *                                                     └────────────┴──────────────┘
 *                                                              join ⑁ (all)
 *                                                                │ SIGN_OFF
 *                                                         signed-off
 *                                                                │ DEPART
 *                                                           departed ✓
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
  certifies: z.literal(true), // must explicitly assert readiness
});

const DepartSchema = z.object({
  platform: z.number().int().min(1),
  scheduledAt: z.string(), // ISO 8601
});

// ─── Workflow definition — Config-First pattern ───────────────────────────────
//
// All state IDs are declared upfront. TypeScript infers the union
//   'reported-for-duty' | 'briefed' | 'inspection-fork' | 'mechanical' |
//   'electrical' | 'safety-systems' | 'inspections-joined' | 'signed-off' | 'departed'
// from the `states` array, so every subsequent call is constrained to that set.
//
// `addFork` and `addJoin` autocomplete their `targets`/`requires` arrays to
// members of this union — no manual type annotations required.

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
  .addStep('briefed', { label: 'Briefed' })

  // branches registered first so fork targets are in TStates at call time
  .addStep('mechanical', { label: 'Mechanical Check' })
  .addStep('electrical', { label: 'Electrical Check' })
  .addStep('safety-systems', { label: 'Safety Systems Check' })

  .addFork('inspection-fork', {
    label: 'Inspection Fork',
    targets: ['mechanical', 'electrical', 'safety-systems'],
  })

  // requires: autocompletes to the declared state union
  .addJoin('inspections-joined', {
    label: 'Inspections Complete',
    requires: ['mechanical', 'electrical', 'safety-systems'],
    mode: 'all',
  })

  .addStep('signed-off', { label: 'Signed Off' })
  .addStep('departed', { label: 'Departed' })

  // ── Graph ─────────────────────────────────────────────────────────────────
  .setInitial('reported-for-duty')
  .setTerminal(['departed'])

  .addTransition({ from: 'reported-for-duty', to: 'briefed', on: 'BRIEFING_RECEIVED' })
  .addTransition({ from: 'briefed', to: 'inspection-fork', on: 'START_INSPECTION' })
  .addTransition({ from: 'mechanical', to: 'inspections-joined', on: 'MECH_OK' })
  .addTransition({ from: 'electrical', to: 'inspections-joined', on: 'ELEC_OK' })
  .addTransition({ from: 'safety-systems', to: 'inspections-joined', on: 'SAFETY_OK' })
  .addTransition({
    from: 'inspections-joined',
    to: 'signed-off',
    on: 'SIGN_OFF',
    // Guard: engineer must certify personally, not a stand-in
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
  let result = await instance.dispatch('BRIEFING_RECEIVED', {
    trainId: 'ENG-042',
    routeCode: 'NS1',
    shiftTime: '06:00',
  });
  console.log(`[1] Briefing received — state: ${instance.getCurrentStates()}`);

  // Step 2: Kick off parallel inspections
  result = await instance.dispatch('START_INSPECTION', {});
  console.log(`[2] Inspections started — active: ${instance.getCurrentStates()}`);
  // → 3 streams are now active simultaneously

  // Step 3: Each technician clears their stream (order doesn't matter)
  result = await instance.dispatch('ELEC_OK', {
    technicianId: 'ELEC-7',
    notes: 'All circuits nominal, no fault codes',
  });
  console.log(`[3] Electrical cleared — active: ${instance.getCurrentStates()}`);

  result = await instance.dispatch('SAFETY_OK', {
    technicianId: 'SAFE-3',
    notes: 'Emergency brakes, door interlocks, CCTV OK',
  });
  console.log(`[4] Safety systems cleared — active: ${instance.getCurrentStates()}`);

  result = await instance.dispatch('MECH_OK', {
    technicianId: 'MECH-12',
    notes: 'Bogie, couplings, pantograph — all within spec',
  });
  console.log(`[5] Mechanical cleared — active: ${instance.getCurrentStates()}`);
  // JoinState auto-activates once all three complete

  // Step 4: Engineer signs off
  result = await instance.dispatch('SIGN_OFF', {
    engineerId: 'ENG-042',
    certifies: true,
  });
  console.log(`[6] Signed off — state: ${instance.getCurrentStates()}`);

  // Step 5: Depart
  result = await instance.dispatch('DEPART', {
    platform: 3,
    scheduledAt: '2024-05-20T06:00:00+08:00',
  });
  if (result.success) {
    console.log(`[7] Departed platform 3 ✓`);
    console.log(`\nWorkflow terminal: ${instance.isTerminal()}`);
    console.log(`History entries: ${instance.getSnapshot().history.length}`);
    console.log(`Snapshot version: ${instance.getSnapshot().version}`);
  }

  // ─── Demonstrate a guard block ───────────────────────────────────────────────
  console.log('\n=== Guard demo: can a sign-off with certifies=false pass? ===\n');

  const blocked = engineerChecklist.createInstance('ENG-099-demo');
  await blocked.dispatch('BRIEFING_RECEIVED', {
    trainId: 'ENG-099',
    routeCode: 'EW2',
    shiftTime: '14:00',
  });
  await blocked.dispatch('START_INSPECTION', {});
  await blocked.dispatch('MECH_OK', { technicianId: 'MECH-1' });
  await blocked.dispatch('ELEC_OK', { technicianId: 'ELEC-1' });
  await blocked.dispatch('SAFETY_OK', { technicianId: 'SAFE-1' });

  // Attempt to sign off with a falsified form (the Zod schema requires the literal `true`)
  try {
    // prettier-ignore
    // @ts-expect-error — intentional: simulating a form submission without the checkbox ticked
    const guardResult = await blocked.dispatch('SIGN_OFF', { engineerId: 'ENG-099', certifies: false });
    if (!guardResult.success) {
      console.log(`Sign-off blocked: reason = "${guardResult.reason}"`);
      console.log(`State unchanged: ${blocked.getCurrentStates()}`);
    }
  } catch (err: unknown) {
    // Zod throws before the engine even sees it when `certifies` is not `true`
    console.log(`Zod validation rejected the payload: ${(err as Error).message.split('\n')[0]}`);
  }
}

runChecklist().catch(console.error);
