# OCC Service Disruption SOP

The incident-response protocol the Operations Control Centre (OCC) follows when a train service disruption is detected. This is the most complex example — it combines multi-role guards, parallel notification branches, and a wait state delegating to an external bus-bridging SOP.

**Features shown:** `Guard.inject` with role-based auth context, fork + join + `WaitState` in one workflow, `resolveWait` with an external snapshot, `JsonGraphExporter`.

## Workflow diagram

```
incident-detected
     │ VERIFY  (guard: isController)
     ▼
incident-verified
     │ ESCALATE_TO_DM  (guard: isController)
     ▼
duty-manager-notified
     │ AUTHORISE_RESPONSE  (guard: isDutyManager)
     ▼
response-authorised ──START_NOTIFICATIONS──▶ notification-fork ⑂
                                             /        |          \
                                       ops-team  stn-masters  public-comms
                                             \        |          /
                                        notification-join ⑁ (all)
                                                  │ START_BUS_BRIDGE  (guard: isDutyManager)
                                                  ▼
                                           bus-bridging ⤴  (WaitState)
                                                  │ BUS_BRIDGE_ACTIVE
                                                  ▼
                                           service-disrupted
                                                  │ SERVICE_RESTORED  (guard: isController)
                                                  ▼
                                           service-restored
                                                  │ FILE_REPORT  (guard: isSupervisor)
                                                  ▼
                                           incident-closed ✓
```

## Full code

```ts
import { z } from 'zod';
import { createWorkflow, Guard } from 'flowyd';
import { MermaidExporter, JsonGraphExporter } from 'flowyd/visualization';

// ── Domain types ────────────────────────────────────────────────────────────

type OccRole = 'controller' | 'duty-manager' | 'supervisor' | 'station-master';

interface OccActor {
  staffId: string;
  role: OccRole;
}

// ── Action schemas ──────────────────────────────────────────────────────────

const ActorRef = z.object({ staffId: z.string(), role: z.string() });

const IncidentVerifySchema = z.object({
  verifiedBy: ActorRef,
  incidentType: z.enum(['signal-fault', 'train-breakdown', 'door-fault', 'track-obstruction', 'power-failure']),
  affectedLine: z.string(),
  affectedKm: z.number(),
  summary: z.string(),
});

const EscalateSchema = z.object({
  escalatedBy: ActorRef,
  dmStaffId: z.string(),
  urgency: z.enum(['P1', 'P2', 'P3']),
});

const AuthoriseSchema = z.object({
  authorisedBy: ActorRef,
  responseType: z.enum(['bus-bridging', 'short-working', 'single-line-working']),
});

const StartNotificationsSchema = z.object({ startedBy: ActorRef });

const NotifyOpsSchema = z.object({
  notifiedBy: z.object({ staffId: z.string() }),
  channel: z.string(),
  confirmedAt: z.string(),
});

const NotifyStnMastersSchema = z.object({
  notifiedBy: z.object({ staffId: z.string() }),
  stationsCount: z.number(),
  method: z.string(),
});

const NotifyPublicSchema = z.object({
  notifiedBy: z.object({ staffId: z.string() }),
  channelsUsed: z.array(z.string()),
});

const StartBusBridgeSchema = z.object({
  authorisedBy: ActorRef,
  busBridgeRef: z.string(),
});

const BusBridgeActiveSchema = z.object({
  confirmedBy: z.object({ staffId: z.string() }),
  busCount: z.number(),
  firstBusAt: z.string(),
});

const ServiceRestoredSchema = z.object({
  confirmedBy: ActorRef,
  restoredAt: z.string(),
  remarks: z.string(),
});

const FileReportSchema = z.object({
  filedBy: ActorRef,
  reportRef: z.string(),
  rootCause: z.string(),
  duration: z.number(), // minutes
});

// ── Workflow definition ─────────────────────────────────────────────────────

const occDisruptionSop = createWorkflow({ name: 'occ-disruption-sop' })
  .defineAction('VERIFY', IncidentVerifySchema)
  .defineAction('ESCALATE_TO_DM', EscalateSchema)
  .defineAction('AUTHORISE_RESPONSE', AuthoriseSchema)
  .defineAction('START_NOTIFICATIONS', StartNotificationsSchema)
  .defineAction('NOTIFY_OPS_TEAM', NotifyOpsSchema)
  .defineAction('NOTIFY_STN_MASTERS', NotifyStnMastersSchema)
  .defineAction('NOTIFY_PUBLIC', NotifyPublicSchema)
  .defineAction('START_BUS_BRIDGE', StartBusBridgeSchema)
  .defineAction('BUS_BRIDGE_ACTIVE', BusBridgeActiveSchema)
  .defineAction('SERVICE_RESTORED', ServiceRestoredSchema)
  .defineAction('FILE_REPORT', FileReportSchema)

  .addStep('incident-detected', { label: 'Incident Detected' })
  .addStep('incident-verified', { label: 'Incident Verified' })
  .addStep('duty-manager-notified', { label: 'DM Notified' })
  .addStep('response-authorised', { label: 'Response Authorised' })
  .addStep('ops-team', { label: 'Ops Team Notified' })
  .addStep('stn-masters', { label: 'Station Masters Notified' })
  .addStep('public-comms', { label: 'Public Comms Notified' })
  .addFork('notification-fork', { targets: ['ops-team', 'stn-masters', 'public-comms'] })
  .addJoin('notification-join', {
    requires: ['ops-team', 'stn-masters', 'public-comms'],
    mode: 'all',
  })
  .addWait('bus-bridging', { externalName: 'bus-bridging-sop' })
  .addStep('service-disrupted', { label: 'Service Disrupted (Managed)' })
  .addStep('service-restored', { label: 'Service Restored' })
  .addStep('incident-closed', { label: 'Incident Closed' })

  .setInitial('incident-detected')
  .setTerminal(['incident-closed'])

  .addTransition({ from: 'incident-detected', to: 'incident-verified', on: 'VERIFY', guard: Guard.inject('isController') })
  .addTransition({ from: 'incident-verified', to: 'duty-manager-notified', on: 'ESCALATE_TO_DM', guard: Guard.inject('isController') })
  .addTransition({ from: 'duty-manager-notified', to: 'response-authorised', on: 'AUTHORISE_RESPONSE', guard: Guard.inject('isDutyManager') })
  .addTransition({ from: 'response-authorised', to: 'notification-fork', on: 'START_NOTIFICATIONS' })
  .addTransition({ from: 'ops-team', to: 'notification-join', on: 'NOTIFY_OPS_TEAM' })
  .addTransition({ from: 'stn-masters', to: 'notification-join', on: 'NOTIFY_STN_MASTERS' })
  .addTransition({ from: 'public-comms', to: 'notification-join', on: 'NOTIFY_PUBLIC' })
  .addTransition({ from: 'notification-join', to: 'bus-bridging', on: 'START_BUS_BRIDGE', guard: Guard.inject('isDutyManager') })
  .addTransition({ from: 'bus-bridging', to: 'service-disrupted', on: 'BUS_BRIDGE_ACTIVE' })
  .addTransition({ from: 'service-disrupted', to: 'service-restored', on: 'SERVICE_RESTORED', guard: Guard.inject('isController') })
  .addTransition({ from: 'service-restored', to: 'incident-closed', on: 'FILE_REPORT', guard: Guard.inject('isSupervisor') })

  .build();

// ── Execution ───────────────────────────────────────────────────────────────

async function runDisruptionSop() {
  // Personnel on shift
  const ctrl: OccActor = { staffId: 'OCC-C01', role: 'controller' };
  const dm: OccActor = { staffId: 'OCC-D03', role: 'duty-manager' };
  const supv: OccActor = { staffId: 'OCC-S01', role: 'supervisor' };

  const inst = occDisruptionSop.createInstance('INC-20240520-0042');

  // The guards read from a `currentActor` closure that simulates request context.
  // In production, read from the authenticated user's JWT/session.
  let currentActor: OccActor | null = null;

  inst
    .injectGuard('isController', async () => currentActor?.role === 'controller')
    .injectGuard('isDutyManager', async () => currentActor?.role === 'duty-manager')
    .injectGuard('isSupervisor', async () => currentActor?.role === 'supervisor');

  // Step 1: Controller verifies the incident
  currentActor = ctrl;
  await inst.dispatch('VERIFY', {
    verifiedBy: { staffId: ctrl.staffId, role: ctrl.role },
    incidentType: 'signal-fault',
    affectedLine: 'NS',
    affectedKm: 18.4,
    summary: 'Signal failure at Jurong East junction',
  });
  console.log(inst.getCurrentStates()); // ['incident-verified']

  // Step 2: Controller escalates to Duty Manager
  await inst.dispatch('ESCALATE_TO_DM', {
    escalatedBy: { staffId: ctrl.staffId, role: ctrl.role },
    dmStaffId: dm.staffId,
    urgency: 'P1',
  });

  // Step 3: DM authorises the response
  currentActor = dm;
  await inst.dispatch('AUTHORISE_RESPONSE', {
    authorisedBy: { staffId: dm.staffId, role: dm.role },
    responseType: 'bus-bridging',
  });

  // Step 4: Start all three notification streams simultaneously
  currentActor = ctrl;
  await inst.dispatch('START_NOTIFICATIONS', { startedBy: { staffId: ctrl.staffId, role: ctrl.role } });
  console.log(inst.getCurrentStates()); // ['ops-team', 'stn-masters', 'public-comms']

  // Step 5: Each stream completes (order does not matter)
  await inst.dispatch('NOTIFY_STN_MASTERS', { notifiedBy: { staffId: ctrl.staffId }, stationsCount: 5, method: 'OCC-intercom' });
  await inst.dispatch('NOTIFY_PUBLIC', { notifiedBy: { staffId: ctrl.staffId }, channelsUsed: ['display-boards', 'twitter'] });
  await inst.dispatch('NOTIFY_OPS_TEAM', { notifiedBy: { staffId: ctrl.staffId }, channel: 'radio', confirmedAt: new Date().toISOString() });
  // JoinState activates automatically after the third notification
  console.log(inst.getCurrentStates()); // ['notification-join']

  // Step 6: DM authorises bus bridging — enters WaitState
  currentActor = dm;
  await inst.dispatch('START_BUS_BRIDGE', {
    authorisedBy: { staffId: dm.staffId, role: dm.role },
    busBridgeRef: 'BB-001',
  });
  console.log(inst.getCurrentStates()); // ['bus-bridging'] — status: 'waiting'

  // Step 7: Bus-bridging SOP completes externally.
  // In production: a separate WorkflowInstance runs the bus-bridging SOP.
  // When it reaches terminal, your service calls resolveWait().
  const externalSnap = occDisruptionSop.createInstance('BB-001').getSnapshot();
  inst.resolveWait('bus-bridging', externalSnap);
  console.log(inst.getCurrentStates()); // ['bus-bridging'] — status now 'active'

  // Step 8: Confirm buses are in position
  currentActor = ctrl;
  await inst.dispatch('BUS_BRIDGE_ACTIVE', {
    confirmedBy: { staffId: ctrl.staffId },
    busCount: 12,
    firstBusAt: new Date().toISOString(),
  });

  // Step 9: Service restored
  await inst.dispatch('SERVICE_RESTORED', {
    confirmedBy: { staffId: ctrl.staffId, role: ctrl.role },
    restoredAt: new Date().toISOString(),
    remarks: 'Signal equipment replaced. Test runs completed.',
  });

  // Step 10: Supervisor files the post-incident report
  currentActor = supv;
  await inst.dispatch('FILE_REPORT', {
    filedBy: { staffId: supv.staffId, role: supv.role },
    reportRef: 'PIR-20240520-0042',
    rootCause: 'Degraded signal relay — scheduled replacement overdue by 14 days',
    duration: 87,
  });

  const snap = inst.getSnapshot();
  console.log(inst.isTerminal());       // true
  console.log(snap.version);            // 12
  console.log(snap.history.length);     // 12

  // ── Guard block demo ─────────────────────────────────────────────────────
  // A station master cannot verify an incident — only controllers can
  const blocked = occDisruptionSop.createInstance('INC-BLOCKED');
  let blockedActor: OccActor | null = null;
  blocked
    .injectGuard('isController', async () => blockedActor?.role === 'controller')
    .injectGuard('isDutyManager', async () => blockedActor?.role === 'duty-manager')
    .injectGuard('isSupervisor', async () => blockedActor?.role === 'supervisor');

  blockedActor = { staffId: 'STN-M99', role: 'station-master' };
  const denied = await blocked.dispatch('VERIFY', {
    verifiedBy: { staffId: 'STN-M99', role: 'station-master' },
    incidentType: 'track-obstruction',
    affectedLine: 'EW',
    affectedKm: 5.1,
    summary: 'Object on track',
  });
  console.log(denied.success);                           // false
  console.log(!denied.success && denied.reason);        // 'guard-failed'
  console.log(blocked.getCurrentStates());              // ['incident-detected'] — unchanged

  // ── JSON graph for dashboard integration ─────────────────────────────────
  const graph = JsonGraphExporter.export(occDisruptionSop.getDefinition());
  console.log(`Nodes: ${graph.nodes.length}, Edges: ${graph.edges.length}`);
  const guardedTransitions = graph.edges.filter((e) => e.hasGuard).map((e) => e.action);
  console.log('Guarded:', guardedTransitions.join(', '));
}

runDisruptionSop().catch(console.error);
```

## What to notice

**Named guards simulate auth context via closure.** The `currentActor` variable mimics what a real system gets from a request context (JWT, session). The guards themselves stay pure — they just read from their injection closure.

**Fork + join + wait in sequence.** This example chains all three "automatic" state types: the fork fans out, the join re-synchronises, and the wait state pauses the workflow for an external SOP. All three resolve without the caller needing extra dispatches.

**`resolveWait` accepts an external snapshot.** The optional second argument stores the bus-bridging SOP's final snapshot inside the parent's audit history. This gives a complete audit trail across both workflows.

**`JsonGraphExporter` exposes guard metadata.** The `hasGuard` flag on each edge lets a dashboard highlight which transitions require authorization, useful for building access-aware UI affordances.
