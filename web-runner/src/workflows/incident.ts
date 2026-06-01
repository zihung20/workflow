import { z } from 'zod';
import { createWorkflow, Guard } from 'flowyd';

/**
 * IT Security Incident Response workflow.
 *
 * Demonstrates: setContext (severity + breach flag), parallel investigation
 * tracks, optional WaitState vendor escalation, parallel post-incident review,
 * Guard.fn with context, Guard.and combining inject + instanceState check,
 * and three distinct terminal states.
 *
 * Happy path:
 *   detected → triaged → [root-cause-analysis | stakeholders-notified]
 *           → investigation-join → containing → eradicating → recovering
 *           → [technical-review | post-mortem-draft] → review-join → resolved
 *
 * Vendor detour (P1 / data breach only):
 *   containing → awaiting-vendor (WaitState) → eradicating
 *
 * Escape hatches:
 *   investigation-join → dismissed  (false alarm; P3/P4 only)
 *   eradicating        → escalated  (data breach or P1 requiring authorities)
 */

// ── Context ────────────────────────────────────────────────────────────────────

const IncidentContextSchema = z.object({
  severity:       z.enum(['P1', 'P2', 'P3', 'P4']),
  isDataBreach:   z.boolean(),
  affectedSystem: z.string().min(1),
});

// ── Action schemas ─────────────────────────────────────────────────────────────

const TriageSchema = z.object({
  assignedTo:        z.string().min(1),
  confirmedSeverity: z.enum(['P1', 'P2', 'P3', 'P4']),
  runbook:           z.string().optional(),
});

const StartInvestigationSchema = z.object({
  leadEngineer: z.string().min(1),
  teamSize:     z.number().int().min(1),
});

const RootCauseSchema = z.object({
  rootCause:  z.string().min(10),
  confidence: z.enum(['confirmed', 'suspected', 'unknown']),
});

const NotifySchema = z.object({
  notifiedBy: z.string().min(1),
  channels:   z.array(z.string()).min(1),
});

const ContainSchema = z.object({
  actionsTaken:  z.string().min(10),
  reducedImpact: z.boolean(),
});

const VendorSchema = z.object({
  vendorTicketId:    z.string().min(1),
  expectedSlaHours: z.number().int().min(1),
});

const VendorResponseSchema = z.object({
  resolution:   z.string().min(1),
  patchApplied: z.boolean(),
});

const ApplyFixSchema = z.object({
  fixApplied: z.string().min(1),
  verifiedBy: z.string().min(1),
});

const RestoreSchema = z.object({
  recoveredBy: z.string().min(1),
  verifiedAt:  z.string().min(1),
  uptimeCheck: z.boolean(),
});

const TechReviewSchema = z.object({
  findings:       z.array(z.string()),
  regressionRisk: z.enum(['low', 'medium', 'high']),
});

const PostMortemSchema = z.object({
  draftUrl:    z.string().min(1),
  actionItems: z.number().int().min(0),
});

const CloseSchema = z.object({
  closedBy:      z.string().min(1),
  postMortemUrl: z.string().min(1),
});

const DismissSchema = z.object({
  dismissedBy: z.string().min(1),
  reason:      z.string().min(10),
});

const EscalateSchema = z.object({
  escalatedTo: z.string().min(1),
  authority:   z.enum(['legal', 'regulator', 'executive', 'law-enforcement']),
  reason:      z.string().min(10),
});

// ── Reusable guards ────────────────────────────────────────────────────────────

// Vendor escalation is only warranted for P1 incidents or confirmed data breaches.
const engageVendorGuard = Guard.fn<
  z.infer<typeof VendorSchema>,
  z.infer<typeof IncidentContextSchema>
>((ctx) => ctx.context.severity === 'P1' || ctx.context.isDataBreach);

// Low-severity false alarms may be dismissed; critical incidents must be worked.
const dismissGuard = Guard.fn<
  z.infer<typeof DismissSchema>,
  z.infer<typeof IncidentContextSchema>
>((ctx) =>
  (ctx.context.severity === 'P3' || ctx.context.severity === 'P4') &&
  !ctx.context.isDataBreach,
);

// Closing an incident requires incident-manager approval AND, for data breaches,
// proof that stakeholders were notified (checked via instanceState — prevents
// silently closing a breach that skipped the comms track).
const closeGuard = Guard.and([
  Guard.inject('incident-manager'),
  Guard.fn<z.infer<typeof CloseSchema>, z.infer<typeof IncidentContextSchema>>(
    (ctx) =>
      !ctx.context.isDataBreach ||
      ctx.instanceState.isStateCompleted('stakeholders-confirmed'),
  ),
]);

// ── Workflow ──────────────────────────────────────────────────────────────────

export const incidentWorkflow = createWorkflow({ name: 'it-incident-response' })
  .setContext(IncidentContextSchema)

  .defineAction('TRIAGE',               TriageSchema)
  .defineAction('START_INVESTIGATION',  StartInvestigationSchema)
  .defineAction('ROOT_CAUSE_FOUND',     RootCauseSchema)
  .defineAction('NOTIFY_STAKEHOLDERS',  NotifySchema)
  .defineAction('BEGIN_CONTAINMENT',    ContainSchema)
  .defineAction('ENGAGE_VENDOR',        VendorSchema)
  .defineAction('VENDOR_RESPONDED',     VendorResponseSchema)
  .defineAction('APPLY_FIX',            ApplyFixSchema)
  .defineAction('SERVICE_RESTORED',     RestoreSchema)
  .defineAction('START_REVIEW',         z.object({}))
  .defineAction('COMPLETE_TECH_REVIEW', TechReviewSchema)
  .defineAction('DRAFT_POST_MORTEM',    PostMortemSchema)
  .defineAction('CLOSE',                CloseSchema)
  .defineAction('DISMISS',              DismissSchema)
  .defineAction('ESCALATE',             EscalateSchema)

  // Parallel investigation branches (must precede their fork)
  // done states — auto-complete; join waits on these
  .addStep('root-cause-documented',    { label: 'Root Cause Documented' })
  .addStep('stakeholders-confirmed',   { label: 'Stakeholders Confirmed' })
  // in-progress states — fork targets
  .addStep('root-cause-analysis',   { label: 'Root Cause Analysis' })
  .addStep('stakeholders-notified', { label: 'Stakeholders Notified' })
  .addFork('investigation-fork', { label: 'Investigation Fork',
    targets: ['root-cause-analysis', 'stakeholders-notified'] })
  .addJoin('investigation-join', { label: 'Investigation Complete',
    requires: ['root-cause-documented', 'stakeholders-confirmed'], mode: 'all' })

  // Parallel post-incident review branches (must precede their fork)
  // done states — auto-complete; join waits on these
  .addStep('tech-review-complete',    { label: 'Tech Review Complete' })
  .addStep('post-mortem-complete',    { label: 'Post-mortem Complete' })
  // in-progress states — fork targets
  .addStep('technical-review', { label: 'Technical Review' })
  .addStep('post-mortem-draft', { label: 'Post-mortem Draft' })
  .addFork('review-fork', { label: 'Review Fork',
    targets: ['technical-review', 'post-mortem-draft'] })
  .addJoin('review-join', { label: 'Review Complete',
    requires: ['tech-review-complete', 'post-mortem-complete'], mode: 'all' })

  // Main states
  .addStep('detected',   { label: 'Detected' })
  .addStep('triaged',    { label: 'Triaged' })
  .addStep('containing', { label: 'Containing' })
  .addWait('awaiting-vendor', { label: 'Awaiting Vendor', externalName: 'vendor-support' })
  .addStep('eradicating', { label: 'Eradicating' })
  .addStep('recovering',  { label: 'Recovering' })

  // Terminals
  .addStep('resolved',  { label: 'Resolved' })
  .addStep('escalated', { label: 'Escalated to Authorities' })
  .addStep('dismissed', { label: 'Dismissed (False Alarm)' })

  .setInitial('detected')
  .setTerminal(['resolved', 'escalated', 'dismissed'])

  // ── Transitions ──────────────────────────────────────────────────────────────

  .addTransition({ from: 'detected', to: 'triaged',            on: 'TRIAGE' })
  .addTransition({ from: 'triaged',  to: 'investigation-fork', on: 'START_INVESTIGATION' })

  // Each investigation track dispatches its action → done state auto-completes
  .addTransition({ from: 'root-cause-analysis',  to: 'root-cause-documented',  on: 'ROOT_CAUSE_FOUND' })
  .addTransition({ from: 'stakeholders-notified', to: 'stakeholders-confirmed', on: 'NOTIFY_STAKEHOLDERS' })

  // After investigation: dismiss (false alarm) or move to containment
  .addTransition({ from: 'investigation-join', to: 'dismissed', on: 'DISMISS',
    guard: dismissGuard })
  .addTransition({ from: 'investigation-join', to: 'containing', on: 'BEGIN_CONTAINMENT',
    guard: (ctx) => ctx.payload.reducedImpact })

  // Containment: normal fix path, or vendor detour for P1/data-breach
  .addTransition({ from: 'containing', to: 'eradicating',     on: 'APPLY_FIX' })
  .addTransition({ from: 'containing', to: 'awaiting-vendor', on: 'ENGAGE_VENDOR',
    guard: engageVendorGuard })

  // Vendor path: after resolveWait('vendor-support'), dispatch VENDOR_RESPONDED to rejoin
  .addTransition({ from: 'awaiting-vendor', to: 'eradicating', on: 'VENDOR_RESPONDED' })

  .addTransition({ from: 'eradicating', to: 'recovering', on: 'SERVICE_RESTORED',
    guard: (ctx) => ctx.payload.uptimeCheck })

  // Escalation: P1 incidents or data breaches that require external authorities
  .addTransition({ from: 'eradicating', to: 'escalated', on: 'ESCALATE',
    guard: Guard.fn<z.infer<typeof EscalateSchema>, z.infer<typeof IncidentContextSchema>>(
      (ctx) => ctx.context.isDataBreach || ctx.context.severity === 'P1',
    ) })

  // Post-incident review runs technical and post-mortem tracks in parallel
  .addTransition({ from: 'recovering',       to: 'review-fork',          on: 'START_REVIEW' })
  .addTransition({ from: 'technical-review', to: 'tech-review-complete', on: 'COMPLETE_TECH_REVIEW' })
  .addTransition({ from: 'post-mortem-draft', to: 'post-mortem-complete', on: 'DRAFT_POST_MORTEM' })

  // Closing requires incident-manager approval; data breaches need stakeholder-notified proof
  .addTransition({ from: 'review-join', to: 'resolved', on: 'CLOSE',
    guard: closeGuard })

  .build();

export type IncidentInstance = ReturnType<typeof incidentWorkflow.createInstance>;
