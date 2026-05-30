import { z } from 'zod';
import { createWorkflow, Guard } from 'flowyd';
import type { WorkflowInstance } from 'flowyd';

const SeverityEnum = z.enum(['P1', 'P2', 'P3', 'P4']);

const DetectSchema = z.object({
  reportedBy: z.string().min(1),
  severity:   SeverityEnum,
  summary:    z.string().min(1),
});

const TriageSchema = z.object({
  assignedTo: z.string().min(1),
  confirmed:  SeverityEnum,
});

const InvestigateSchema = z.object({
  leadEngineer: z.string().min(1),
  teamSize:     z.number().int().min(1),
});

const ContainSchema = z.object({
  actionsTaken: z.string().min(1),
});

const EradicateSchema = z.object({
  rootCause:  z.string().min(10),
  fixApplied: z.string().min(1),
});

const RecoverSchema = z.object({
  recoveredBy:  z.string().min(1),
  verifiedAt:   z.string().min(1),
});

const CloseSchema = z.object({
  closedBy:     z.string().min(1),
  postMortemUrl: z.string().min(1),
});

export const incidentWorkflow = createWorkflow({
  name: 'it-incident-response',
})
  .defineAction('DETECT',      DetectSchema)
  .defineAction('TRIAGE',      TriageSchema)
  .defineAction('INVESTIGATE', InvestigateSchema)
  .defineAction('CONTAIN',     ContainSchema)
  .defineAction('ERADICATE',   EradicateSchema)
  .defineAction('RECOVER',     RecoverSchema)
  .defineAction('CLOSE',       CloseSchema)

  .addStep('detected',      { label: 'Detected' })
  .addStep('triaged',       { label: 'Triaged' })
  .addStep('investigating', { label: 'Investigating' })
  .addStep('contained',     { label: 'Contained' })
  .addStep('eradicated',    { label: 'Eradicated' })
  .addStep('recovered',     { label: 'Recovered' })
  .addStep('closed',        { label: 'Closed' })

  .setInitial('detected')
  .setTerminal(['closed'])

  .addTransition({ from: 'detected',     to: 'triaged',      on: 'TRIAGE' })
  .addTransition({ from: 'triaged',      to: 'investigating',on: 'INVESTIGATE' })
  .addTransition({ from: 'investigating',to: 'contained',    on: 'CONTAIN',
    guard: (ctx) => ctx.payload.actionsTaken.trim().length >= 5 })
  .addTransition({ from: 'contained',    to: 'eradicated',   on: 'ERADICATE',
    guard: (ctx) => ctx.payload.rootCause.trim().length >= 10 })
  .addTransition({ from: 'eradicated',   to: 'recovered',    on: 'RECOVER',
    guard: Guard.inject('management-sign-off') })
  .addTransition({ from: 'recovered',    to: 'closed',       on: 'CLOSE' })

  .build();

export type IncidentInstance = WorkflowInstance<{
  DETECT:      z.infer<typeof DetectSchema>;
  TRIAGE:      z.infer<typeof TriageSchema>;
  INVESTIGATE: z.infer<typeof InvestigateSchema>;
  CONTAIN:     z.infer<typeof ContainSchema>;
  ERADICATE:   z.infer<typeof EradicateSchema>;
  RECOVER:     z.infer<typeof RecoverSchema>;
  CLOSE:       z.infer<typeof CloseSchema>;
}>;
