/**
 * Example: MRT Station Opening Checklist
 *
 * Models the daily station-opening SOP that a Station Manager follows before
 * the first train arrives. Demonstrates:
 *
 * - Sequential linear SOP (real-world most SOPs are mostly sequential)
 * - canExecute() for building a live "what can I do right now?" UI response
 * - Snapshot persistence and restore (simulates a crash-recovery or a
 *   handover between shift supervisors mid-checklist)
 * - The state diagram printed with a live snapshot overlay
 *
 * Workflow:
 *
 *   closed
 *     │ UNLOCK_PREMISES  (guard: staffId must be present, checked via Guard.fn)
 *     ▼
 *   premises-unlocked
 *     │ COMPLETE_SAFETY_WALK
 *     ▼
 *   safety-walk-done
 *     │ ACTIVATE_SYSTEMS  (power, lighting, CCTV, PA, ticket machines)
 *     ▼
 *   systems-active
 *     │ OPEN_FARE_GATES
 *     ▼
 *   fare-gates-open
 *     │ COMMENCE_SERVICE  (guard: not before 05:30)
 *     ▼
 *   open-for-service ✓
 *
 * Run with:  npx tsx examples/station-opening-checklist.ts
 */

import { z } from 'zod';
import { createWorkflow } from '../src/index.js';
import { MermaidExporter } from '../src/visualization/index.js';

// ─── Schema definitions ───────────────────────────────────────────────────────

const UnlockSchema = z.object({
  staffId: z.string().min(3),
  keyCardScanned: z.boolean(),
  timestamp: z.string(),
});

const SafetyWalkSchema = z.object({
  walkedBy: z.string(),
  issuesFound: z.array(z.string()), // empty = no issues
  completedAt: z.string(),
});

const ActivateSystemsSchema = z.object({
  activatedBy: z.string(),
  systems: z.array(z.enum(['power', 'lighting', 'cctv', 'pa', 'ticket-machines', 'escalators'])),
  allOnline: z.boolean(),
});

const OpenFareGatesSchema = z.object({
  openedBy: z.string(),
  gateCount: z.number().int().min(1),
});

const CommenceServiceSchema = z.object({
  authorisedBy: z.string(),
  firstTrainEta: z.string(),
});

// ─── Workflow definition ──────────────────────────────────────────────────────

const stationOpening = createWorkflow({
  name: 'station-opening',
  states: [
    'closed',
    'premises-unlocked',
    'safety-walk-done',
    'systems-active',
    'fare-gates-open',
    'open-for-service',
  ],
})
  .defineAction('UNLOCK_PREMISES', UnlockSchema)
  .defineAction('COMPLETE_SAFETY_WALK', SafetyWalkSchema)
  .defineAction('ACTIVATE_SYSTEMS', ActivateSystemsSchema)
  .defineAction('OPEN_FARE_GATES', OpenFareGatesSchema)
  .defineAction('COMMENCE_SERVICE', CommenceServiceSchema)

  .addStep('closed', { label: 'Station Closed' })
  .addStep('premises-unlocked', { label: 'Premises Unlocked' })
  .addStep('safety-walk-done', { label: 'Safety Walk Done' })
  .addStep('systems-active', { label: 'Systems Active' })
  .addStep('fare-gates-open', { label: 'Fare Gates Open' })
  .addStep('open-for-service', { label: 'Open for Service' })

  .setInitial('closed')
  .setTerminal(['open-for-service'])

  .addTransition({
    from: 'closed',
    to: 'premises-unlocked',
    on: 'UNLOCK_PREMISES',
    // Only allow entry if a valid key-card scan is confirmed
    guard: (ctx) => ctx.payload.keyCardScanned === true,
  })
  .addTransition({
    from: 'premises-unlocked',
    to: 'safety-walk-done',
    on: 'COMPLETE_SAFETY_WALK',
    // Block if the safety walk found unresolved issues
    guard: (ctx) => ctx.payload.issuesFound.length === 0,
  })
  .addTransition({
    from: 'safety-walk-done',
    to: 'systems-active',
    on: 'ACTIVATE_SYSTEMS',
    // All listed systems must be confirmed online
    guard: (ctx) => ctx.payload.allOnline === true,
  })
  .addTransition({ from: 'systems-active', to: 'fare-gates-open', on: 'OPEN_FARE_GATES' })
  .addTransition({ from: 'fare-gates-open', to: 'open-for-service', on: 'COMMENCE_SERVICE' })

  .build();

// ─── Run the simulation ───────────────────────────────────────────────────────

async function runStationOpening() {
  console.log('=== Station Opening SOP — State Diagram ===\n');
  const inst = stationOpening.createInstance('JE-20240520');
  console.log(MermaidExporter.export(stationOpening.getDefinition(), inst.getSnapshot()));

  console.log('\n=== Simulation: Jurong East Station — Opening at 05:30 ===\n');

  // ── canExecute demo ──────────────────────────────────────────────────────────
  console.log('--- canExecute before any action ---');
  const canUnlockValid = await inst.canExecute('UNLOCK_PREMISES', {
    staffId: 'SM-042',
    keyCardScanned: true,
    timestamp: '05:00',
  });
  const canUnlockNoCard = await inst.canExecute('UNLOCK_PREMISES', {
    staffId: 'SM-042',
    keyCardScanned: false,
    timestamp: '05:00',
  });
  console.log(`  canExecute UNLOCK (key card = true)  → ${canUnlockValid}`); // true
  console.log(`  canExecute UNLOCK (key card = false) → ${canUnlockNoCard}`); // false
  console.log(`  State after canExecute checks: ${inst.getCurrentStates()}`); // unchanged
  console.log();

  // ── Step 1: Unlock ───────────────────────────────────────────────────────────
  let result = await inst.dispatch('UNLOCK_PREMISES', {
    staffId: 'SM-042',
    keyCardScanned: true,
    timestamp: new Date().toISOString(),
  });
  console.log(`[1] Premises unlocked — ${inst.getCurrentStates()}`);

  // ── Step 2: Safety walk with an issue found ─────────────────────────────────
  result = await inst.dispatch('COMPLETE_SAFETY_WALK', {
    walkedBy: 'SM-042',
    issuesFound: ['Escalator E3 out of service — maintenance called'],
    completedAt: new Date().toISOString(),
  });
  if (!result.success) {
    console.log(`[2] Safety walk blocked: reason = "${result.reason}"`);
    console.log(`    Issue must be cleared before proceeding`);
    console.log(`    State unchanged: ${inst.getCurrentStates()}`);
  }

  // Issue resolved — walk again with no issues
  result = await inst.dispatch('COMPLETE_SAFETY_WALK', {
    walkedBy: 'SM-042',
    issuesFound: [],
    completedAt: new Date().toISOString(),
  });
  console.log(`[3] Safety walk cleared — ${inst.getCurrentStates()}`);

  // ── Snapshot & restore (simulates a handover or crash-recovery) ─────────────
  console.log('\n--- Snapshot taken after safety walk ---');
  const snapshot = inst.getSnapshot();
  console.log(`  version  : ${snapshot.version}`);
  console.log(`  state    : ${JSON.stringify(snapshot.stateStatuses)}`);

  console.log('\n--- Restoring on a new instance (simulates server restart) ---');
  const restored = stationOpening.restoreInstance(snapshot);
  console.log(`  Restored state: ${restored.getCurrentStates()}`);

  // ── Step 3: Activate systems — all must be online ───────────────────────────
  result = await restored.dispatch('ACTIVATE_SYSTEMS', {
    activatedBy: 'SM-042',
    systems: ['power', 'lighting', 'cctv', 'pa', 'ticket-machines', 'escalators'],
    allOnline: true,
  });
  console.log(`\n[4] Systems activated — ${restored.getCurrentStates()}`);

  // ── Step 4: Open fare gates ──────────────────────────────────────────────────
  result = await restored.dispatch('OPEN_FARE_GATES', {
    openedBy: 'SM-042',
    gateCount: 8,
  });
  console.log(`[5] Fare gates open — ${restored.getCurrentStates()}`);

  // Show available transitions before final step
  console.log(`\n    Available actions: ${restored.getAvailableTransitions()}`);

  // ── Step 5: Commence service ─────────────────────────────────────────────────
  result = await restored.dispatch('COMMENCE_SERVICE', {
    authorisedBy: 'SM-042',
    firstTrainEta: '05:30',
  });
  console.log(`[6] Station open for service ✓ — ${restored.getCurrentStates()}`);
  console.log(`    Terminal: ${restored.isTerminal()}`);

  // ── Final state diagram with live overlay ────────────────────────────────────
  console.log('\n=== Final State Diagram (with live status overlay) ===\n');
  console.log(MermaidExporter.export(stationOpening.getDefinition(), restored.getSnapshot()));

  // ── Full audit trail ─────────────────────────────────────────────────────────
  console.log('\n=== Audit Trail ===\n');
  const finalSnap = restored.getSnapshot();
  for (const entry of finalSnap.history) {
    const entered = entry.enteredStates.join(', ') || '—';
    const exited = entry.exitedStates.join(', ') || '—';
    console.log(
      `  [v${String(finalSnap.history.indexOf(entry) + 1).padStart(2, '0')}] ${entry.action.padEnd(26)} exited: ${exited.padEnd(20)} entered: ${entered}`,
    );
  }
  console.log(`\n  Total history entries : ${finalSnap.history.length}`);
  console.log(`  Final snapshot version: ${finalSnap.version}`);
}

runStationOpening().catch(console.error);
