/**
 * Example: MRT Operation Control Centre (OCC) — Service Disruption SOP
 *
 * Models the incident-response protocol the OCC follows when a train service
 * disruption is detected. Covers:
 *
 * - Multi-role guard enforcement (only a Controller can verify; only a Duty
 *   Manager can authorise bus bridging; only the Control Supervisor can close)
 * - Parallel notification branches (Train Ops team + Station Masters + SMRT
 *   comms) that must ALL complete before the OCC can move to monitoring
 * - A wait state that delegates the physical bus bridging coordination to a
 *   separate SOP and blocks until it confirms buses are in position
 * - Incident closure requiring a post-incident report
 *
 * Workflow diagram:
 *
 *   incident-detected
 *        │ VERIFY  (guard: isController)
 *        ▼
 *   incident-verified
 *        │ ESCALATE_TO_DM  (guard: isController)
 *        ▼
 *   duty-manager-notified
 *        │ AUTHORISE_RESPONSE  (guard: isDutyManager)
 *        ▼
 *   response-authorised ──▶ notification-fork ⑂
 *                            /          |         \
 *                     ops-team    stn-masters   public-comms
 *                            \          |         /
 *                         notification-join ⑁ (all)
 *                                   │ START_BUS_BRIDGE  (guard: isDutyManager)
 *                                   ▼
 *                            bus-bridging ⤴  (WaitState: bus-bridging-sop)
 *                                   │ BUS_BRIDGE_ACTIVE
 *                                   ▼
 *                            service-disrupted
 *                                   │ SERVICE_RESTORED  (guard: isController)
 *                                   ▼
 *                            service-restored
 *                                   │ FILE_REPORT  (guard: isSupervisor)
 *                                   ▼
 *                            incident-closed ✓
 *
 * Run with:  npx tsx examples/occ-disruption-sop.ts
 */

import { z } from 'zod';
import { createWorkflow, Guard } from '../src/index.js';
import { MermaidExporter, JsonGraphExporter } from '../src/visualization/index.js';

// ─── Domain types (roles come in via JWT/session in a real system) ─────────────

type OccRole = 'controller' | 'duty-manager' | 'supervisor' | 'station-master';

interface OccActor {
  staffId: string;
  role: OccRole;
  name: string;
}

// ─── Schema definitions ───────────────────────────────────────────────────────

const IncidentVerifySchema = z.object({
  verifiedBy: z.object({ staffId: z.string(), role: z.string() }),
  incidentType: z.enum([
    'signal-fault',
    'train-breakdown',
    'door-fault',
    'track-obstruction',
    'power-failure',
  ]),
  affectedLine: z.string(),
  affectedKm: z.number(),
  summary: z.string(),
});

const EscalateSchema = z.object({
  escalatedBy: z.object({ staffId: z.string(), role: z.string() }),
  dmStaffId: z.string(),
  urgency: z.enum(['P1', 'P2', 'P3']),
});

const AuthoriseSchema = z.object({
  authorisedBy: z.object({ staffId: z.string(), role: z.string() }),
  responseType: z.enum(['bus-bridging', 'short-working', 'full-suspension']),
});

const StartNotificationsSchema = z.object({
  startedBy: z.object({ staffId: z.string(), role: z.string() }),
});

const NotifyOpsSchema = z.object({
  notifiedBy: z.object({ staffId: z.string() }),
  channel: z.enum(['radio', 'phone', 'operations-system']),
  confirmedAt: z.string(),
});

const NotifyStnSchema = z.object({
  notifiedBy: z.object({ staffId: z.string() }),
  stationsCount: z.number().int().min(1),
  method: z.enum(['PA', 'OCC-intercom', 'phone']),
});

const NotifyPublicSchema = z.object({
  notifiedBy: z.object({ staffId: z.string() }),
  channelsUsed: z.array(z.enum(['twitter', 'lta-datamall', 'display-boards', 'announcement'])),
});

const BusBridgeSchema = z.object({
  authorisedBy: z.object({ staffId: z.string(), role: z.string() }),
  busBridgeRef: z.string(), // reference ID for the sub-workflow
});

const BusBridgeActiveSchema = z.object({
  confirmedBy: z.object({ staffId: z.string() }),
  busCount: z.number().int().min(1),
  firstBusAt: z.string(),
});

const ServiceRestoredSchema = z.object({
  confirmedBy: z.object({ staffId: z.string(), role: z.string() }),
  restoredAt: z.string(),
  remarks: z.string().optional(),
});

const FileReportSchema = z.object({
  filedBy: z.object({ staffId: z.string(), role: z.string() }),
  reportRef: z.string(),
  rootCause: z.string(),
  duration: z.number().positive(), // minutes
});

// ─── Role guard factories ──────────────────────────────────────────────────────

// These would normally resolve from an auth token in a real system.
// Here we use Guard.inject() so they can be provided at runtime.
const isController = Guard.inject('isController');
const isDutyManager = Guard.inject('isDutyManager');
const isSupervisor = Guard.inject('isSupervisor');

// ─── Workflow definition ──────────────────────────────────────────────────────

const occDisruptionSop = createWorkflow({
  name: 'occ-service-disruption',
})
  .defineAction('VERIFY', IncidentVerifySchema)
  .defineAction('ESCALATE_TO_DM', EscalateSchema)
  .defineAction('AUTHORISE_RESPONSE', AuthoriseSchema)
  .defineAction('START_NOTIFICATIONS', StartNotificationsSchema)
  .defineAction('NOTIFY_OPS_TEAM', NotifyOpsSchema)
  .defineAction('NOTIFY_STN_MASTERS', NotifyStnSchema)
  .defineAction('NOTIFY_PUBLIC', NotifyPublicSchema)
  .defineAction('START_BUS_BRIDGE', BusBridgeSchema)
  .defineAction('BUS_BRIDGE_ACTIVE', BusBridgeActiveSchema)
  .defineAction('SERVICE_RESTORED', ServiceRestoredSchema)
  .defineAction('FILE_REPORT', FileReportSchema)

  // States
  .addStep('incident-detected', { label: 'Incident Detected' })
  .addStep('incident-verified', { label: 'Incident Verified' })
  .addStep('duty-manager-notified', { label: 'DM Notified' })
  .addStep('response-authorised', { label: 'Response Authorised' })
  // branches registered first so fork targets are in TStates at call time
  .addStep('ops-team', { label: 'Notifying Ops Team' })
  .addStep('stn-masters', { label: 'Notifying Station Masters' })
  .addStep('public-comms', { label: 'Notifying Public' })
  .addFork('notification-fork', {
    label: 'Notification Fork',
    targets: ['ops-team', 'stn-masters', 'public-comms'],
  })
  .addJoin('notification-join', {
    label: 'All Parties Notified',
    requires: ['ops-team', 'stn-masters', 'public-comms'],
    mode: 'all',
  })
  .addWait('bus-bridging', { label: 'Bus Bridging', externalName: 'bus-bridging-sop' })
  .addStep('service-disrupted', { label: 'Disruption Active' })
  .addStep('service-restored', { label: 'Service Restored' })
  .addStep('incident-closed', { label: 'Incident Closed' })

  .setInitial('incident-detected')
  .setTerminal(['incident-closed'])

  .addTransition({
    from: 'incident-detected',
    to: 'incident-verified',
    on: 'VERIFY',
    guard: isController,
  })
  .addTransition({
    from: 'incident-verified',
    to: 'duty-manager-notified',
    on: 'ESCALATE_TO_DM',
    guard: isController,
  })
  .addTransition({
    from: 'duty-manager-notified',
    to: 'response-authorised',
    on: 'AUTHORISE_RESPONSE',
    guard: isDutyManager,
  })
  .addTransition({ from: 'response-authorised', to: 'notification-fork', on: 'START_NOTIFICATIONS' })
  .addTransition({ from: 'ops-team', to: 'notification-join', on: 'NOTIFY_OPS_TEAM' })
  .addTransition({ from: 'stn-masters', to: 'notification-join', on: 'NOTIFY_STN_MASTERS' })
  .addTransition({ from: 'public-comms', to: 'notification-join', on: 'NOTIFY_PUBLIC' })
  .addTransition({
    from: 'notification-join',
    to: 'bus-bridging',
    on: 'START_BUS_BRIDGE',
    guard: isDutyManager,
  })
  .addTransition({ from: 'bus-bridging', to: 'service-disrupted', on: 'BUS_BRIDGE_ACTIVE' })
  .addTransition({
    from: 'service-disrupted',
    to: 'service-restored',
    on: 'SERVICE_RESTORED',
    guard: isController,
  })
  .addTransition({
    from: 'service-restored',
    to: 'incident-closed',
    on: 'FILE_REPORT',
    guard: isSupervisor,
  })

  .build();

// ─── Simulation helpers ───────────────────────────────────────────────────────

function makeRoleGuard(actor: OccActor, requiredRole: OccRole) {
  return async () => actor.role === requiredRole;
}

function logStep(label: string, states: string[]) {
  const stateStr = states.map((s) => `[${s}]`).join(', ');
  console.log(`  ${label.padEnd(38)} → ${stateStr}`);
}

// ─── Print diagram ────────────────────────────────────────────────────────────

console.log('=== OCC Service Disruption SOP — State Diagram ===\n');
console.log(MermaidExporter.export(occDisruptionSop.getDefinition()));

// ─── Run the simulation ───────────────────────────────────────────────────────

async function runDisruptionSop() {
  console.log('\n=== Simulation: Signal Fault on NS Line, km 18.4 ===\n');

  // Personnel on shift
  const ctrl: OccActor = { staffId: 'OCC-C01', role: 'controller', name: 'Controller Chen' };
  const dm: OccActor = { staffId: 'OCC-D03', role: 'duty-manager', name: 'Duty Manager Lim' };
  const supv: OccActor = { staffId: 'OCC-S01', role: 'supervisor', name: 'Supervisor Tan' };

  const inst = occDisruptionSop.createInstance('INC-20240520-0042');

  // Inject role guards — in production these read from the caller's auth token
  inst
    .injectGuard('isController', async () => currentActor?.role === 'controller')
    .injectGuard('isDutyManager', async () => currentActor?.role === 'duty-manager')
    .injectGuard('isSupervisor', async () => currentActor?.role === 'supervisor');

  // Track who is performing the current action (simulates request context)
  let currentActor: OccActor | null = null;

  // ── Step 1: Controller detects and verifies the incident ────────────────────
  currentActor = ctrl;
  await inst.dispatch('VERIFY', {
    verifiedBy: { staffId: ctrl.staffId, role: ctrl.role },
    incidentType: 'signal-fault',
    affectedLine: 'NS',
    affectedKm: 18.4,
    summary: 'Signal failure at Jurong East junction — trains holding at JE and BN',
  });
  logStep('1. Incident verified by Controller', inst.getCurrentStates());

  // ── Step 2: Controller escalates to Duty Manager ────────────────────────────
  await inst.dispatch('ESCALATE_TO_DM', {
    escalatedBy: { staffId: ctrl.staffId, role: ctrl.role },
    dmStaffId: dm.staffId,
    urgency: 'P1',
  });
  logStep('2. Escalated to DM', inst.getCurrentStates());

  // ── Step 3: Duty Manager authorises bus bridging response ───────────────────
  currentActor = dm;
  await inst.dispatch('AUTHORISE_RESPONSE', {
    authorisedBy: { staffId: dm.staffId, role: dm.role },
    responseType: 'bus-bridging',
  });
  logStep('3. DM authorised response', inst.getCurrentStates());

  // ── Step 4: Fork — kick off all three notification streams ──────────────────
  currentActor = ctrl;
  await inst.dispatch('START_NOTIFICATIONS', {
    startedBy: { staffId: ctrl.staffId, role: ctrl.role },
  });
  logStep('4. Fork entered → 3 streams active', inst.getCurrentStates());

  // ── Step 5: Each stream completes independently ─────────────────────────────
  await inst.dispatch('NOTIFY_STN_MASTERS', {
    notifiedBy: { staffId: ctrl.staffId },
    stationsCount: 5,
    method: 'OCC-intercom',
  });
  logStep('5. Station masters notified', inst.getCurrentStates());

  await inst.dispatch('NOTIFY_PUBLIC', {
    notifiedBy: { staffId: ctrl.staffId },
    channelsUsed: ['display-boards', 'announcement', 'twitter'],
  });
  logStep('6. Public comms notified', inst.getCurrentStates());

  // Final ops-team notification — triggers JoinState auto-activation
  await inst.dispatch('NOTIFY_OPS_TEAM', {
    notifiedBy: { staffId: ctrl.staffId },
    channel: 'radio',
    confirmedAt: new Date().toISOString(),
  });
  logStep('7. Join activated (all notified)', inst.getCurrentStates());

  // ── Step 6: DM authorises bus bridging wait state ────────────────────────────
  currentActor = dm;
  const bbRef = `BB-${Date.now()}`;
  await inst.dispatch('START_BUS_BRIDGE', {
    authorisedBy: { staffId: dm.staffId, role: dm.role },
    busBridgeRef: bbRef,
  });
  logStep('8. Bus bridging wait state entered', inst.getCurrentStates());
  // State is now 'waiting' — the parent SOP is paused

  // ── Step 7: Bus-bridging SOP completes externally ───────────────────────────
  // In production: bus-bridging-sop runs in a separate WorkflowInstance.
  // When it reaches terminal, the service calls resolveWait().
  console.log('\n  [external] Bus bridging SOP running...');
  console.log('  [external] Buses confirmed at JE, CS, BN ✓');

  const fakeExternalSnap = occDisruptionSop.createInstance(bbRef).getSnapshot();
  inst.resolveWait('bus-bridging', fakeExternalSnap);
  logStep('9. Wait state resolved', inst.getCurrentStates());

  // ── Step 8: Confirm buses are active; advance past WaitState ─────────────────
  currentActor = ctrl;
  await inst.dispatch('BUS_BRIDGE_ACTIVE', {
    confirmedBy: { staffId: ctrl.staffId },
    busCount: 12,
    firstBusAt: new Date().toISOString(),
  });
  logStep('10. Bus bridge active — disruption managed', inst.getCurrentStates());

  // ── Step 9: Service restored after engineers fix the signal ─────────────────
  await inst.dispatch('SERVICE_RESTORED', {
    confirmedBy: { staffId: ctrl.staffId, role: ctrl.role },
    restoredAt: new Date().toISOString(),
    remarks: 'Signal equipment replaced by P-Way team. Test runs completed.',
  });
  logStep('11. Service restored', inst.getCurrentStates());

  // ── Step 10: Supervisor closes with post-incident report ────────────────────
  currentActor = supv;
  await inst.dispatch('FILE_REPORT', {
    filedBy: { staffId: supv.staffId, role: supv.role },
    reportRef: 'PIR-20240520-0042',
    rootCause: 'Degraded signal relay at NS-18 — scheduled replacement overdue by 14 days',
    duration: 87,
  });
  logStep('12. Report filed — incident closed', inst.getCurrentStates());

  // ── Summary ──────────────────────────────────────────────────────────────────
  const snap = inst.getSnapshot();
  console.log('\n─── Incident Summary ───────────────────────────────────────');
  console.log(`  Instance ID : ${snap.instanceId}`);
  console.log(`  Terminal    : ${inst.isTerminal()}`);
  console.log(`  Version     : ${snap.version}`);
  console.log(`  Steps taken : ${snap.history.length}`);
  console.log(`  Actions     : ${snap.history.map((h) => h.action).join(' → ')}`);

  // ── Guard block demo ─────────────────────────────────────────────────────────
  console.log('\n=== Guard demo: station master cannot verify an incident ===\n');
  const stnMaster: OccActor = { staffId: 'STN-M99', role: 'station-master', name: 'SM Ng' };

  const blocked = occDisruptionSop.createInstance('INC-BLOCKED-DEMO');
  let blockedActor: OccActor | null = null;
  blocked
    .injectGuard('isController', async () => blockedActor?.role === 'controller')
    .injectGuard('isDutyManager', async () => blockedActor?.role === 'duty-manager')
    .injectGuard('isSupervisor', async () => blockedActor?.role === 'supervisor');

  blockedActor = stnMaster;
  const denyResult = await blocked.dispatch('VERIFY', {
    verifiedBy: { staffId: stnMaster.staffId, role: stnMaster.role },
    incidentType: 'track-obstruction',
    affectedLine: 'EW',
    affectedKm: 5.1,
    summary: 'Object on track reported by driver',
  });

  if (!denyResult.success) {
    console.log(`  SM Ng tried to verify → blocked: reason = "${denyResult.reason}"`);
    console.log(`  State unchanged: ${blocked.getCurrentStates()}`);
  }

  // ── JSON graph for dashboard integration ─────────────────────────────────────
  console.log('\n=== JSON Graph (node count, for dashboard) ===\n');
  const graph = JsonGraphExporter.export(occDisruptionSop.getDefinition());
  console.log(`  Nodes   : ${graph.nodes.length}`);
  console.log(`  Edges   : ${graph.edges.length}`);
  console.log(`  Actions : ${graph.meta.actionNames.join(', ')}`);
  console.log(
    `  Guarded transitions: ${graph.edges
      .filter((e) => e.hasGuard)
      .map((e) => e.action)
      .join(', ')}`,
  );
}

runDisruptionSop().catch(console.error);
