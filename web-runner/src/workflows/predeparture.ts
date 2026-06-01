import { z } from "zod";
import { createWorkflow } from "flowyd";

const BriefingSchema = z.object({
  trainId: z.string().min(1),
  routeCode: z.string().min(1),
  shiftTime: z.string().min(1),
});

const InspectionSchema = z.object({
  technicianId: z.string().min(1),
  notes: z.string().optional(),
});

const SignOffSchema = z.object({
  engineerId: z.string().min(1),
  certifies: z.literal(true),
});

const DepartSchema = z.object({
  platform: z.number().int().min(1),
  scheduledAt: z.string().min(1),
});

export const predepartureWorkflow = createWorkflow({
  name: "engineer-predeparture-checklist",
})
  .defineAction("BRIEFING_RECEIVED", BriefingSchema)
  .defineAction("START_INSPECTION", z.object({}))
  .defineAction("MECH_OK", InspectionSchema)
  .defineAction("ELEC_OK", InspectionSchema)
  .defineAction("SAFETY_OK", InspectionSchema)
  .defineAction("SIGN_OFF", SignOffSchema)
  .defineAction("DEPART", DepartSchema)

  .addStep("reported-for-duty", { label: "Reported for Duty" })
  .addStep("briefed", { label: "Briefed" })

  // done states — auto-complete when entered; join waits on these
  .addStep("mech-cleared",   { label: "Mechanical Check Cleared" })
  .addStep("elec-cleared",   { label: "Electrical Check Cleared" })
  .addStep("safety-cleared", { label: "Safety Check Cleared" })
  // in-progress states — fork targets; each needs an explicit dispatch
  .addStep("mechanical",     { label: "Mechanical Check" })
  .addStep("electrical",     { label: "Electrical Check" })
  .addStep("safety-systems", { label: "Safety Systems Check" })

  .addFork("inspection-fork", {
    label: "Inspection Fork",
    targets: ["mechanical", "electrical", "safety-systems"],
  })
  .addJoin("inspections-joined", {
    label: "Inspections Complete",
    requires: ["mech-cleared", "elec-cleared", "safety-cleared"],
    mode: "all",
  })
  .addStep("signed-off", { label: "Signed Off" })
  .addStep("departed",   { label: "Departed" })

  .setInitial("reported-for-duty")
  .setTerminal(["departed"])

  .addTransition({ from: "reported-for-duty", to: "briefed",         on: "BRIEFING_RECEIVED" })
  .addTransition({ from: "briefed",           to: "inspection-fork", on: "START_INSPECTION" })

  // each technician dispatches their check action; the done state auto-completes
  .addTransition({ from: "mechanical",     to: "mech-cleared",   on: "MECH_OK" })
  .addTransition({ from: "electrical",     to: "elec-cleared",   on: "ELEC_OK" })
  .addTransition({ from: "safety-systems", to: "safety-cleared", on: "SAFETY_OK" })

  .addTransition({
    from: "inspections-joined",
    to: "signed-off",
    on: "SIGN_OFF",
    guard: (ctx) => ctx.payload.certifies,
  })
  .addTransition({ from: "signed-off", to: "departed", on: "DEPART" })

  .build();

export type PredepartureInstance = ReturnType<
  typeof predepartureWorkflow.createInstance
>;
