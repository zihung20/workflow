# Engineer Pre-Departure Checklist

A train engineer must complete three independent inspection streams — mechanical, electrical, and safety systems — before signing off for departure. All three run in parallel; the sign-off is only available once all three are done.

**Features shown:** `ForkState`, `JoinState mode:'all'`, inline guard with Zod `literal`, parallel execution trace.

## Workflow diagram

```
reported-for-duty
     │ BRIEFING_RECEIVED
     ▼
briefed ──START_INSPECTION──▶ inspection-fork ⑂
                              /       |        \
                        mechanical electrical safety-systems
                              \       |        /
                          inspections-joined ⑁ (all)
                                    │ SIGN_OFF
                               signed-off
                                    │ DEPART
                               departed ✓
```

## Full code

```ts
import { z } from 'zod';
import { createWorkflow } from 'logic-workflow';
import { MermaidExporter } from 'logic-workflow/visualization';

// ── Action schemas ──────────────────────────────────────────────────────────

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
  certifies: z.literal(true), // Zod literal — must be exactly `true`, not just truthy
});

const DepartSchema = z.object({
  platform: z.number().int().min(1),
  scheduledAt: z.string(), // ISO 8601
});

// ── Workflow definition ─────────────────────────────────────────────────────
//
// `addFork` targets and `addJoin` requires both autocomplete to the declared
// state union. A misspelled target is a compile error.

const engineerChecklist = createWorkflow({
  name: 'engineer-predeparture-checklist',
  states: [
    'reported-for-duty',
    'briefed',
    'inspection-fork',
    'mechanical',
    'electrical',
    'safety-systems',
    'inspections-joined',
    'signed-off',
    'departed',
  ],
})
  .defineAction('BRIEFING_RECEIVED', BriefingSchema)
  .defineAction('START_INSPECTION', z.object({}))
  .defineAction('MECH_OK', InspectionSchema)
  .defineAction('ELEC_OK', InspectionSchema)
  .defineAction('SAFETY_OK', InspectionSchema)
  .defineAction('SIGN_OFF', SignOffSchema)
  .defineAction('DEPART', DepartSchema)

  .addStep('reported-for-duty', { label: 'Reported for Duty' })
  .addStep('briefed', { label: 'Briefed' })
  .addFork('inspection-fork', {
    label: 'Inspection Fork',
    targets: ['mechanical', 'electrical', 'safety-systems'],
  })
  .addStep('mechanical', { label: 'Mechanical Check' })
  .addStep('electrical', { label: 'Electrical Check' })
  .addStep('safety-systems', { label: 'Safety Systems Check' })
  .addJoin('inspections-joined', {
    label: 'Inspections Complete',
    requires: ['mechanical', 'electrical', 'safety-systems'],
    mode: 'all',
  })
  .addStep('signed-off', { label: 'Signed Off' })
  .addStep('departed', { label: 'Departed' })

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
    guard: (ctx) => ctx.payload.certifies === true,
  })
  .addTransition({ from: 'signed-off', to: 'departed', on: 'DEPART' })

  .build();

// ── Execution ───────────────────────────────────────────────────────────────

async function runChecklist() {
  const instance = engineerChecklist.createInstance('ENG-042-20240520-0600');

  // Step 1: Morning briefing
  await instance.dispatch('BRIEFING_RECEIVED', {
    trainId: 'ENG-042',
    routeCode: 'NS1',
    shiftTime: '06:00',
  });
  console.log(instance.getCurrentStates()); // ['briefed']

  // Step 2: Kick off parallel inspections
  // ForkState is transient — it completes in the same engine tick and activates all targets
  await instance.dispatch('START_INSPECTION', {});
  console.log(instance.getCurrentStates()); // ['mechanical', 'electrical', 'safety-systems']

  // Step 3: Each technician clears their stream — order does not matter
  await instance.dispatch('ELEC_OK', { technicianId: 'ELEC-7', notes: 'All circuits nominal' });
  console.log(instance.getCurrentStates()); // ['mechanical', 'safety-systems']

  await instance.dispatch('SAFETY_OK', { technicianId: 'SAFE-3' });
  console.log(instance.getCurrentStates()); // ['mechanical']

  // Final inspection — JoinState auto-activates once all three complete
  await instance.dispatch('MECH_OK', { technicianId: 'MECH-12', notes: 'All within spec' });
  console.log(instance.getCurrentStates()); // ['inspections-joined']

  // Step 4: Engineer signs off
  await instance.dispatch('SIGN_OFF', { engineerId: 'ENG-042', certifies: true });
  console.log(instance.getCurrentStates()); // ['signed-off']

  // Step 5: Depart
  const result = await instance.dispatch('DEPART', {
    platform: 3,
    scheduledAt: '2024-05-20T06:00:00+08:00',
  });
  console.log(result.success);               // true
  console.log(instance.isTerminal());        // true
  console.log(instance.getSnapshot().history.length); // 7

  // ── Guard demo: certifies must be the literal `true` ──────────────────────
  // The Zod schema uses z.literal(true) — passing `false` is caught twice:
  //   1. TypeScript rejects it at compile time (type 'false' is not assignable to 'true')
  //   2. Zod throws ZodError at runtime if somehow the wrong value arrives

  // ── Visualize ────────────────────────────────────────────────────────────
  console.log(MermaidExporter.export(engineerChecklist.getDefinition(), instance.getSnapshot()));
}

runChecklist().catch(console.error);
```

## What to notice

**ForkState is never in `getCurrentStates`.**  After dispatching `START_INSPECTION`, the fork completes immediately and the three inspection states are what's active. The fork is a routing node, not a resting place.

**JoinState activates automatically.** After the third inspection clears, the engine's fixed-point loop detects that all `requires` states are completed and activates `inspections-joined` in the same `dispatch` call. No extra action needed.

**Zod `literal(true)` for boolean safety.** `certifies: z.literal(true)` means the type is `true`, not `boolean`. Passing `false` is rejected at compile time. This pattern is useful for "I explicitly confirm this" checkboxes.

**`MermaidExporter.export(definition, snapshot)` overlays live status.** The snapshot colours states by their current status — completed in green, active in blue.
