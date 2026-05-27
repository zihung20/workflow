# Station Opening Checklist

The daily station-opening SOP a Station Manager follows before the first train arrives. This example focuses on two practical patterns: using `canExecute` to build a "what can I do right now?" UI response, and snapshot hand-off to simulate crash recovery or shift handover.

**Features shown:** sequential flow with inline guards, `canExecute`, `getSnapshot` / `restoreInstance`, `getAvailableTransitions`, Mermaid live status overlay.

## Workflow diagram

```
closed
  │ UNLOCK_PREMISES  (guard: keyCardScanned === true)
  ▼
premises-unlocked
  │ COMPLETE_SAFETY_WALK  (guard: issuesFound.length === 0)
  ▼
safety-walk-done
  │ ACTIVATE_SYSTEMS  (guard: allOnline === true)
  ▼
systems-active
  │ OPEN_FARE_GATES
  ▼
fare-gates-open
  │ COMMENCE_SERVICE
  ▼
open-for-service ✓
```

## Full code

```ts
import { z } from 'zod';
import { createWorkflow } from 'flowyd';
import { MermaidExporter } from 'flowyd/visualization';

// ── Action schemas ──────────────────────────────────────────────────────────

const UnlockSchema = z.object({
  staffId: z.string().min(3),
  keyCardScanned: z.boolean(),
  timestamp: z.string(),
});

const SafetyWalkSchema = z.object({
  walkedBy: z.string(),
  issuesFound: z.array(z.string()), // empty array = no issues
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

// ── Workflow definition ─────────────────────────────────────────────────────

const stationOpening = createWorkflow({ name: 'station-opening' })
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
    guard: (ctx) => ctx.payload.keyCardScanned === true,
  })
  .addTransition({
    from: 'premises-unlocked',
    to: 'safety-walk-done',
    on: 'COMPLETE_SAFETY_WALK',
    guard: (ctx) => ctx.payload.issuesFound.length === 0,
  })
  .addTransition({
    from: 'safety-walk-done',
    to: 'systems-active',
    on: 'ACTIVATE_SYSTEMS',
    guard: (ctx) => ctx.payload.allOnline === true,
  })
  .addTransition({ from: 'systems-active', to: 'fare-gates-open', on: 'OPEN_FARE_GATES' })
  .addTransition({ from: 'fare-gates-open', to: 'open-for-service', on: 'COMMENCE_SERVICE' })

  .build();

// ── Execution ───────────────────────────────────────────────────────────────

async function runStationOpening() {
  const inst = stationOpening.createInstance('JE-20240520');

  // ── canExecute: build a live "what's allowed right now?" response ─────────
  // canExecute evaluates guards but commits no state change.
  // Use it to decide whether to enable/disable UI buttons.

  const canUnlockWithCard = await inst.canExecute('UNLOCK_PREMISES', {
    staffId: 'SM-042',
    keyCardScanned: true,
    timestamp: new Date().toISOString(),
  });
  const canUnlockWithoutCard = await inst.canExecute('UNLOCK_PREMISES', {
    staffId: 'SM-042',
    keyCardScanned: false,
    timestamp: new Date().toISOString(),
  });

  console.log(canUnlockWithCard);    // true  — button enabled
  console.log(canUnlockWithoutCard); // false — button disabled
  console.log(inst.getCurrentStates()); // ['closed'] — canExecute changes nothing

  // Step 1: Unlock
  await inst.dispatch('UNLOCK_PREMISES', {
    staffId: 'SM-042',
    keyCardScanned: true,
    timestamp: new Date().toISOString(),
  });
  console.log(inst.getCurrentStates()); // ['premises-unlocked']

  // Step 2: Safety walk with an issue — guard blocks
  const blocked = await inst.dispatch('COMPLETE_SAFETY_WALK', {
    walkedBy: 'SM-042',
    issuesFound: ['Escalator E3 out of service'],
    completedAt: new Date().toISOString(),
  });
  console.log(blocked.success);              // false
  console.log(!blocked.success && blocked.reason); // 'guard-failed'
  console.log(inst.getCurrentStates());      // ['premises-unlocked'] — unchanged

  // Issue resolved — re-submit with no issues
  await inst.dispatch('COMPLETE_SAFETY_WALK', {
    walkedBy: 'SM-042',
    issuesFound: [],
    completedAt: new Date().toISOString(),
  });
  console.log(inst.getCurrentStates()); // ['safety-walk-done']

  // ── Snapshot hand-off: simulate a shift handover or server restart ────────
  const snapshot = inst.getSnapshot();
  console.log(snapshot.version);       // 2
  console.log(snapshot.stateStatuses); // { closed: 'completed', 'premises-unlocked': 'completed', 'safety-walk-done': 'active', ... }

  // The incoming supervisor (or a restarted server) restores from the snapshot
  const restored = stationOpening.restoreInstance(snapshot);
  console.log(restored.getCurrentStates()); // ['safety-walk-done'] — exactly where it was

  // Step 3: Activate systems
  await restored.dispatch('ACTIVATE_SYSTEMS', {
    activatedBy: 'SM-099',
    systems: ['power', 'lighting', 'cctv', 'pa', 'ticket-machines', 'escalators'],
    allOnline: true,
  });

  // Step 4: Open fare gates
  await restored.dispatch('OPEN_FARE_GATES', { openedBy: 'SM-099', gateCount: 8 });

  // getAvailableTransitions: actions with at least one transition from an active state
  // Does NOT evaluate guards — use for "what actions exist" without the guard round-trip
  console.log(restored.getAvailableTransitions()); // ['COMMENCE_SERVICE']

  // Step 5: Commence service
  await restored.dispatch('COMMENCE_SERVICE', {
    authorisedBy: 'SM-099',
    firstTrainEta: '05:30',
  });

  console.log(restored.getCurrentStates()); // ['open-for-service']
  console.log(restored.isTerminal());       // true

  // ── State diagram with live status overlay ────────────────────────────────
  // Passing the snapshot adds CSS class annotations (active/waiting/completed)
  const diagram = MermaidExporter.export(stationOpening.getDefinition(), restored.getSnapshot());
  console.log(diagram);

  // ── Audit trail ──────────────────────────────────────────────────────────
  const finalSnap = restored.getSnapshot();
  for (const entry of finalSnap.history) {
    console.log(`${entry.action}: exited=${entry.exitedStates}, entered=${entry.enteredStates}`);
  }
  // UNLOCK_PREMISES:       exited=closed,              entered=premises-unlocked
  // COMPLETE_SAFETY_WALK:  exited=premises-unlocked,   entered=safety-walk-done
  // ACTIVATE_SYSTEMS:      exited=safety-walk-done,    entered=systems-active
  // OPEN_FARE_GATES:       exited=systems-active,      entered=fare-gates-open
  // COMMENCE_SERVICE:      exited=fare-gates-open,     entered=open-for-service
}

runStationOpening().catch(console.error);
```

## What to notice

**`canExecute` for UI button states.** Call it before rendering a form or enabling a button. It evaluates guards with the given payload and returns `true/false` without touching the instance state. No database write, no version increment.

**Snapshot hand-off is identical to crash recovery.** `restoreInstance(snapshot)` reconstructs exact state from plain JSON. There is no difference between a planned shift handover and recovery from a server crash — both start with `restoreInstance`.

**`getAvailableTransitions` is guard-free.** It returns action names that have at least one transition from a currently active state, without evaluating guards. Use it for "what actions exist in this state?" menus; use `canExecute` when you also want to know whether the guard will pass for a specific payload.

**Blocked dispatches leave no trace.** The first `COMPLETE_SAFETY_WALK` (with an issue) was blocked. It does not appear in `history`, does not increment `version`, and does not change `stateStatuses`.
