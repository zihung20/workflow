import { z } from 'zod';
import { WorkflowBuilder } from 'logic-workflow';
import type { WorkflowInstance } from 'logic-workflow';

const BriefingSchema = z.object({
  trainId:   z.string().min(1),
  routeCode: z.string().min(1),
  shiftTime: z.string().min(1),
});

const InspectionSchema = z.object({
  technicianId: z.string().min(1),
  notes:        z.string().optional(),
});

const SignOffSchema = z.object({
  engineerId: z.string().min(1),
  certifies:  z.literal(true),
});

const DepartSchema = z.object({
  platform:    z.number().int().min(1),
  scheduledAt: z.string().min(1),
});

export const predepartureWorkflow = new WorkflowBuilder({
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
  ] as const,
})
  .defineAction('BRIEFING_RECEIVED', BriefingSchema)
  .defineAction('START_INSPECTION',  z.object({}))
  .defineAction('MECH_OK',           InspectionSchema)
  .defineAction('ELEC_OK',           InspectionSchema)
  .defineAction('SAFETY_OK',         InspectionSchema)
  .defineAction('SIGN_OFF',          SignOffSchema)
  .defineAction('DEPART',            DepartSchema)

  .addStep('reported-for-duty',  { label: 'Reported for Duty' })
  .addStep('briefed',            { label: 'Briefed' })
  .addFork('inspection-fork',    { label: 'Inspection Fork', targets: ['mechanical', 'electrical', 'safety-systems'] })
  .addStep('mechanical',         { label: 'Mechanical Check' })
  .addStep('electrical',         { label: 'Electrical Check' })
  .addStep('safety-systems',     { label: 'Safety Systems Check' })
  .addJoin('inspections-joined', { label: 'Inspections Complete', requires: ['mechanical', 'electrical', 'safety-systems'], mode: 'all' })
  .addStep('signed-off',         { label: 'Signed Off' })
  .addStep('departed',           { label: 'Departed' })

  .setInitial('reported-for-duty')
  .setTerminal(['departed'])

  .addTransition({ from: 'reported-for-duty',  to: 'briefed',            on: 'BRIEFING_RECEIVED' })
  .addTransition({ from: 'briefed',            to: 'inspection-fork',    on: 'START_INSPECTION' })
  .addTransition({ from: 'mechanical',         to: 'inspections-joined', on: 'MECH_OK' })
  .addTransition({ from: 'electrical',         to: 'inspections-joined', on: 'ELEC_OK' })
  .addTransition({ from: 'safety-systems',     to: 'inspections-joined', on: 'SAFETY_OK' })
  .addTransition({ from: 'inspections-joined', to: 'signed-off',         on: 'SIGN_OFF',
    guard: (ctx) => ctx.payload.certifies })
  .addTransition({ from: 'signed-off',         to: 'departed',           on: 'DEPART' })

  .build();

export type PredepartureInstance = WorkflowInstance<{
  BRIEFING_RECEIVED: z.infer<typeof BriefingSchema>;
  START_INSPECTION:  Record<never, never>;
  MECH_OK:           z.infer<typeof InspectionSchema>;
  ELEC_OK:           z.infer<typeof InspectionSchema>;
  SAFETY_OK:         z.infer<typeof InspectionSchema>;
  SIGN_OFF:          z.infer<typeof SignOffSchema>;
  DEPART:            z.infer<typeof DepartSchema>;
}>;
