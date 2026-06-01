import { z } from 'zod';
import { createWorkflow, Guard } from 'flowyd';

/**
 * Multi-environment production release pipeline for a microservices platform.
 *
 * Demonstrates: setContext, 8 parallel fork/join phases with two-state branch
 * pattern (in-progress state → done state that auto-completes), WaitState
 * observation period, inline payload guards, context-aware Guard.fn,
 * Guard.and / Guard.inject combinators, and ReturnType instance typing.
 *
 * Flow:
 *   draft
 *     → [pre-checks ×5] → [builds ×4] → [tests ×4]
 *     → [staging-deploy ×3] → [staging-validation ×3] → qa-sign-off
 *     → [approvals ×3]
 *     → [prod-deploy ×3] → [prod-validation ×3]
 *     → observation (WaitState) → released ✓
 *
 * Each parallel branch follows the two-state pattern:
 *   fork activates "in-progress" state → dispatch action → "done" state auto-completes
 *   join requires the "done" states, not the in-progress ones.
 */

// ── Release context ────────────────────────────────────────────────────────────

const ReleaseContextSchema = z.object({
  version:     z.string().min(1),
  releaseType: z.enum(['major', 'minor', 'patch', 'hotfix']),
  isEmergency: z.boolean(),
  teamId:      z.string().min(1),
});

// ── Action schemas ─────────────────────────────────────────────────────────────

const SubmitSchema = z.object({
  submittedBy: z.string().min(1),
  description: z.string().min(10),
});

const ApproveSchema = z.object({
  approvedBy: z.string().min(1),
  notes:      z.string(),
});

const SecurityReviewSchema = z.object({
  reviewerId:    z.string().min(1),
  score:         z.number().int().min(0).max(100),
  criticalCount: z.number().int().min(0),
});

const DepAuditSchema = z.object({
  criticalCount: z.number().int().min(0),
  highCount:     z.number().int().min(0),
});

const LicenseScanSchema = z.object({
  blockerCount: z.number().int().min(0),
  warnCount:    z.number().int().min(0),
});

const BuildArtifactSchema = z.object({
  commitSha:   z.string().length(40),
  artifactUrl: z.string().min(1),
  sizeBytes:   z.number().int().positive(),
});

const InfraPlanSchema = z.object({
  planId:       z.string().min(1),
  addCount:     z.number().int().min(0),
  changeCount:  z.number().int().min(0),
  destroyCount: z.number().int().min(0),
});

const TestResultSchema = z.object({
  passed:  z.number().int().min(0),
  failed:  z.number().int().min(0),
  skipped: z.number().int().min(0),
});

const LoadTestSchema = z.object({
  p99Ms:     z.number().positive(),
  p999Ms:    z.number().positive(),
  errorRate: z.number().min(0).max(1),
  rps:       z.number().positive(),
});

const PerformanceSchema = z.object({
  p99Ms:         z.number().positive(),
  rps:           z.number().positive(),
  baselineRatio: z.number().positive(),
});

const RiskApprovalSchema = z.object({
  approvedBy:  z.string().min(1),
  riskLevel:   z.enum(['low', 'medium', 'high']),
  mitigations: z.array(z.string()),
});

const RegionDeploySchema = z.object({
  deployedBy:    z.string().min(1),
  instanceCount: z.number().int().min(1),
  region:        z.enum(['eu-west-1', 'us-east-1', 'ap-southeast-1']),
});

const ObservationSchema = z.object({
  confirmedBy: z.string().min(1),
  alertsFired: z.number().int().min(0),
});

const CancellationSchema = z.object({
  initiatedBy: z.string().min(1),
  reason:      z.string().min(10),
});

// ── Reusable guards ────────────────────────────────────────────────────────────

const securityScoreGuard = Guard.fn<
  z.infer<typeof SecurityReviewSchema>,
  z.infer<typeof ReleaseContextSchema>
>((ctx) => {
  const threshold = ctx.context.releaseType === 'major' ? 90 : 75;
  return ctx.payload.score >= threshold && ctx.payload.criticalCount === 0;
});

const infraDestroyGuard = Guard.fn<
  z.infer<typeof InfraPlanSchema>,
  z.infer<typeof ReleaseContextSchema>
>((ctx) => ctx.context.isEmergency || ctx.payload.destroyCount === 0);

const securityApprovalGuard = Guard.and([
  Guard.inject('security-director'),
  Guard.fn<z.infer<typeof RiskApprovalSchema>>((ctx) => ctx.payload.riskLevel !== 'high'),
]);

const releaseConfirmGuard = Guard.and([
  Guard.inject('cto'),
  Guard.fn<z.infer<typeof ObservationSchema>>((ctx) => ctx.payload.alertsFired < 5),
]);

// ── Workflow ───────────────────────────────────────────────────────────────────

export const releasePipelineWorkflow = createWorkflow({ name: 'release-pipeline' })
  .setContext(ReleaseContextSchema)

  // ── Actions ──────────────────────────────────────────────────────────────────
  .defineAction('SUBMIT',                   SubmitSchema)
  .defineAction('APPROVE_CHANGE_TICKET',    ApproveSchema)
  .defineAction('APPROVE_DESIGN',           ApproveSchema)
  .defineAction('APPROVE_SECURITY_REVIEW',  SecurityReviewSchema)
  .defineAction('COMPLETE_DEP_AUDIT',       DepAuditSchema)
  .defineAction('COMPLETE_LICENSE_SCAN',    LicenseScanSchema)
  .defineAction('START_BUILDS',             z.object({}))
  .defineAction('BUILD_API_DONE',           BuildArtifactSchema)
  .defineAction('BUILD_FRONTEND_DONE',      BuildArtifactSchema)
  .defineAction('BUILD_WORKER_DONE',        BuildArtifactSchema)
  .defineAction('PLAN_INFRA_DONE',          InfraPlanSchema)
  .defineAction('START_TESTS',              z.object({}))
  .defineAction('UNIT_TESTS_PASSED',        TestResultSchema)
  .defineAction('INTEGRATION_TESTS_PASSED', TestResultSchema)
  .defineAction('E2E_TESTS_PASSED',         TestResultSchema)
  .defineAction('LOAD_TESTS_PASSED',        LoadTestSchema)
  .defineAction('DEPLOY_TO_STAGING',        z.object({ deployedBy: z.string().min(1) }))
  .defineAction('STAGING_API_UP',           z.object({ url: z.string().min(1) }))
  .defineAction('STAGING_FRONTEND_UP',      z.object({ url: z.string().min(1) }))
  .defineAction('STAGING_WORKER_UP',        z.object({ url: z.string().min(1) }))
  .defineAction('START_STAGING_VALIDATION', z.object({}))
  .defineAction('STAGING_SMOKE_OK',         z.object({ testedBy: z.string().min(1) }))
  .defineAction('STAGING_REGRESSION_OK',    TestResultSchema)
  .defineAction('STAGING_PERFORMANCE_OK',   PerformanceSchema)
  .defineAction('QA_SIGN_OFF',              ApproveSchema)
  .defineAction('START_APPROVALS',          z.object({}))
  .defineAction('ENGINEERING_APPROVED',     ApproveSchema)
  .defineAction('SECURITY_APPROVED',        RiskApprovalSchema)
  .defineAction('PRODUCT_APPROVED',         ApproveSchema)
  .defineAction('BEGIN_PROD_ROLLOUT',       z.object({}))
  .defineAction('PROD_EU_DEPLOYED',         RegionDeploySchema)
  .defineAction('PROD_US_DEPLOYED',         RegionDeploySchema)
  .defineAction('PROD_APAC_DEPLOYED',       RegionDeploySchema)
  .defineAction('START_PROD_VALIDATION',    z.object({}))
  .defineAction('PROD_EU_SMOKE_OK',         z.object({ testedBy: z.string().min(1) }))
  .defineAction('PROD_US_SMOKE_OK',         z.object({ testedBy: z.string().min(1) }))
  .defineAction('PROD_APAC_SMOKE_OK',       z.object({ testedBy: z.string().min(1) }))
  .defineAction('BEGIN_OBSERVATION',        z.object({}))
  .defineAction('CONFIRM_RELEASE',          ObservationSchema)
  .defineAction('CANCEL',                   CancellationSchema)
  .defineAction('ROLLBACK',                 CancellationSchema)

  // ── States ───────────────────────────────────────────────────────────────────
  // Spine
  .addStep('draft',       { label: 'Draft' })
  .addStep('released',    { label: 'Released' })
  .addStep('rolled-back', { label: 'Rolled Back' })
  .addStep('cancelled',   { label: 'Cancelled' })

  // Phase 1 — pre-checks
  // done states (auto-complete; registered before join)
  .addStep('change-ticket-ok', { label: 'Change Ticket Approved' })
  .addStep('design-ok',        { label: 'Design Approved' })
  .addStep('security-ok',      { label: 'Security Review Approved' })
  .addStep('dep-audit-ok',     { label: 'Dependency Audit Passed' })
  .addStep('license-ok',       { label: 'License Scan Passed' })
  // in-progress states (fork targets)
  .addStep('change-ticket-review', { label: 'Change Ticket Review' })
  .addStep('design-review',        { label: 'Design Review' })
  .addStep('security-review',      { label: 'Security Review' })
  .addStep('dependency-audit',     { label: 'Dependency Audit' })
  .addStep('license-scan',         { label: 'License Scan' })
  .addFork('pre-checks-fork', { label: 'Pre-checks Fork',
    targets: ['change-ticket-review', 'design-review', 'security-review', 'dependency-audit', 'license-scan'] })
  .addJoin('pre-checks-join', { label: 'Pre-checks Complete',
    requires: ['change-ticket-ok', 'design-ok', 'security-ok', 'dep-audit-ok', 'license-ok'], mode: 'all' })

  // Phase 2 — builds
  // done states
  .addStep('api-built',      { label: 'API Built' })
  .addStep('frontend-built', { label: 'Frontend Built' })
  .addStep('worker-built',   { label: 'Worker Built' })
  .addStep('infra-planned',  { label: 'Infra Planned' })
  // in-progress states
  .addStep('api-build',      { label: 'API Build' })
  .addStep('frontend-build', { label: 'Frontend Build' })
  .addStep('worker-build',   { label: 'Worker Build' })
  .addStep('infra-plan',     { label: 'Infrastructure Plan' })
  .addFork('builds-fork', { label: 'Builds Fork',
    targets: ['api-build', 'frontend-build', 'worker-build', 'infra-plan'] })
  .addJoin('builds-join', { label: 'Builds Complete',
    requires: ['api-built', 'frontend-built', 'worker-built', 'infra-planned'], mode: 'all' })

  // Phase 3 — tests
  // done states
  .addStep('unit-tests-ok',        { label: 'Unit Tests Passed' })
  .addStep('integration-tests-ok', { label: 'Integration Tests Passed' })
  .addStep('e2e-tests-ok',         { label: 'E2E Tests Passed' })
  .addStep('load-tests-ok',        { label: 'Load Tests Passed' })
  // in-progress states
  .addStep('unit-tests',        { label: 'Unit Tests' })
  .addStep('integration-tests', { label: 'Integration Tests' })
  .addStep('e2e-tests',         { label: 'E2E Tests' })
  .addStep('load-tests',        { label: 'Load Tests' })
  .addFork('tests-fork', { label: 'Tests Fork',
    targets: ['unit-tests', 'integration-tests', 'e2e-tests', 'load-tests'] })
  .addJoin('tests-join', { label: 'Tests Complete',
    requires: ['unit-tests-ok', 'integration-tests-ok', 'e2e-tests-ok', 'load-tests-ok'], mode: 'all' })

  // Phase 4 — staging deploy
  // done states
  .addStep('staging-api-up',      { label: 'Staging API Up' })
  .addStep('staging-frontend-up', { label: 'Staging Frontend Up' })
  .addStep('staging-worker-up',   { label: 'Staging Worker Up' })
  // in-progress states
  .addStep('staging-api',      { label: 'Staging API Deploy' })
  .addStep('staging-frontend', { label: 'Staging Frontend Deploy' })
  .addStep('staging-worker',   { label: 'Staging Worker Deploy' })
  .addFork('staging-deploy-fork', { label: 'Staging Deploy Fork',
    targets: ['staging-api', 'staging-frontend', 'staging-worker'] })
  .addJoin('staging-deploy-join', { label: 'Staging Deploy Complete',
    requires: ['staging-api-up', 'staging-frontend-up', 'staging-worker-up'], mode: 'all' })

  // Phase 5 — staging validation
  // done states
  .addStep('staging-smoke-ok',       { label: 'Staging Smoke Cleared' })
  .addStep('staging-regression-ok',  { label: 'Staging Regression Cleared' })
  .addStep('staging-performance-ok', { label: 'Staging Performance Cleared' })
  // in-progress states
  .addStep('staging-smoke',       { label: 'Staging Smoke Tests' })
  .addStep('staging-regression',  { label: 'Staging Regression Tests' })
  .addStep('staging-performance', { label: 'Staging Performance Tests' })
  .addFork('staging-validation-fork', { label: 'Staging Validation Fork',
    targets: ['staging-smoke', 'staging-regression', 'staging-performance'] })
  .addJoin('staging-validation-join', { label: 'Staging Validation Complete',
    requires: ['staging-smoke-ok', 'staging-regression-ok', 'staging-performance-ok'], mode: 'all' })

  // Phase 6 — QA gate + approvals
  .addStep('qa-sign-off', { label: 'QA Sign-off' })
  // done states
  .addStep('engineering-approved', { label: 'Engineering Approved' })
  .addStep('security-approved',    { label: 'Security Approved' })
  .addStep('product-approved',     { label: 'Product Approved' })
  // in-progress states
  .addStep('engineering-approval', { label: 'Engineering Approval' })
  .addStep('security-approval',    { label: 'Security Approval' })
  .addStep('product-approval',     { label: 'Product Approval' })
  .addFork('approvals-fork', { label: 'Approvals Fork',
    targets: ['engineering-approval', 'security-approval', 'product-approval'] })
  .addJoin('approvals-join', { label: 'All Approvals Received',
    requires: ['engineering-approved', 'security-approved', 'product-approved'], mode: 'all' })

  // Phase 7 — production deploy (multi-region)
  // done states
  .addStep('prod-eu-up',   { label: 'Prod EU Up' })
  .addStep('prod-us-up',   { label: 'Prod US Up' })
  .addStep('prod-apac-up', { label: 'Prod APAC Up' })
  // in-progress states
  .addStep('prod-eu',   { label: 'Prod EU Deploy' })
  .addStep('prod-us',   { label: 'Prod US Deploy' })
  .addStep('prod-apac', { label: 'Prod APAC Deploy' })
  .addFork('prod-deploy-fork', { label: 'Prod Deploy Fork',
    targets: ['prod-eu', 'prod-us', 'prod-apac'] })
  .addJoin('prod-deploy-join', { label: 'Prod Deploy Complete',
    requires: ['prod-eu-up', 'prod-us-up', 'prod-apac-up'], mode: 'all' })

  // Phase 8 — production validation
  // done states
  .addStep('prod-eu-smoke-ok',   { label: 'Prod EU Smoke Cleared' })
  .addStep('prod-us-smoke-ok',   { label: 'Prod US Smoke Cleared' })
  .addStep('prod-apac-smoke-ok', { label: 'Prod APAC Smoke Cleared' })
  // in-progress states
  .addStep('prod-eu-smoke',   { label: 'Prod EU Smoke' })
  .addStep('prod-us-smoke',   { label: 'Prod US Smoke' })
  .addStep('prod-apac-smoke', { label: 'Prod APAC Smoke' })
  .addFork('prod-validation-fork', { label: 'Prod Validation Fork',
    targets: ['prod-eu-smoke', 'prod-us-smoke', 'prod-apac-smoke'] })
  .addJoin('prod-validation-join', { label: 'Prod Validation Complete',
    requires: ['prod-eu-smoke-ok', 'prod-us-smoke-ok', 'prod-apac-smoke-ok'], mode: 'all' })

  // Phase 9 — observation
  .addWait('observation', { label: 'Observation Period', externalName: 'monitoring-system' })

  .setInitial('draft')
  .setTerminal(['released', 'rolled-back', 'cancelled'])

  // ── Transitions ───────────────────────────────────────────────────────────────

  .addTransition({ from: 'draft', to: 'pre-checks-fork', on: 'SUBMIT' })

  // Phase 1 — pre-checks (each branch → done state which auto-completes)
  .addTransition({ from: 'change-ticket-review', to: 'change-ticket-ok', on: 'APPROVE_CHANGE_TICKET' })
  .addTransition({ from: 'design-review',        to: 'design-ok',        on: 'APPROVE_DESIGN' })
  .addTransition({ from: 'security-review',      to: 'security-ok',      on: 'APPROVE_SECURITY_REVIEW',
    guard: securityScoreGuard })
  .addTransition({ from: 'dependency-audit',     to: 'dep-audit-ok',     on: 'COMPLETE_DEP_AUDIT',
    guard: (ctx) => ctx.payload.criticalCount === 0 })
  .addTransition({ from: 'license-scan',         to: 'license-ok',       on: 'COMPLETE_LICENSE_SCAN',
    guard: (ctx) => ctx.payload.blockerCount === 0 })

  .addTransition({ from: 'pre-checks-join', to: 'builds-fork', on: 'START_BUILDS' })

  // Phase 2 — builds
  .addTransition({ from: 'api-build',      to: 'api-built',      on: 'BUILD_API_DONE' })
  .addTransition({ from: 'frontend-build', to: 'frontend-built', on: 'BUILD_FRONTEND_DONE' })
  .addTransition({ from: 'worker-build',   to: 'worker-built',   on: 'BUILD_WORKER_DONE' })
  .addTransition({ from: 'infra-plan',     to: 'infra-planned',  on: 'PLAN_INFRA_DONE',
    guard: infraDestroyGuard })

  .addTransition({ from: 'builds-join', to: 'tests-fork', on: 'START_TESTS' })

  // Phase 3 — tests
  .addTransition({ from: 'unit-tests',        to: 'unit-tests-ok',        on: 'UNIT_TESTS_PASSED',
    guard: (ctx) => ctx.payload.failed === 0 })
  .addTransition({ from: 'integration-tests', to: 'integration-tests-ok', on: 'INTEGRATION_TESTS_PASSED',
    guard: (ctx) => ctx.payload.failed === 0 })
  .addTransition({ from: 'e2e-tests',         to: 'e2e-tests-ok',         on: 'E2E_TESTS_PASSED',
    guard: (ctx) => ctx.payload.failed === 0 })
  .addTransition({ from: 'load-tests',        to: 'load-tests-ok',        on: 'LOAD_TESTS_PASSED',
    guard: (ctx) => ctx.payload.p99Ms < 200 && ctx.payload.p999Ms < 800 && ctx.payload.errorRate < 0.01 })

  .addTransition({ from: 'tests-join', to: 'staging-deploy-fork', on: 'DEPLOY_TO_STAGING' })

  // Phase 4 — staging deploy
  .addTransition({ from: 'staging-api',      to: 'staging-api-up',      on: 'STAGING_API_UP' })
  .addTransition({ from: 'staging-frontend', to: 'staging-frontend-up', on: 'STAGING_FRONTEND_UP' })
  .addTransition({ from: 'staging-worker',   to: 'staging-worker-up',   on: 'STAGING_WORKER_UP' })

  .addTransition({ from: 'staging-deploy-join', to: 'staging-validation-fork', on: 'START_STAGING_VALIDATION' })

  // Phase 5 — staging validation
  .addTransition({ from: 'staging-smoke',       to: 'staging-smoke-ok',       on: 'STAGING_SMOKE_OK' })
  .addTransition({ from: 'staging-regression',  to: 'staging-regression-ok',  on: 'STAGING_REGRESSION_OK',
    guard: (ctx) => ctx.payload.failed === 0 })
  .addTransition({ from: 'staging-performance', to: 'staging-performance-ok', on: 'STAGING_PERFORMANCE_OK',
    guard: (ctx) => ctx.payload.p99Ms < 200 && ctx.payload.baselineRatio < 1.15 })

  // QA gate — injected qa-lead must approve before approvals phase opens
  .addTransition({ from: 'staging-validation-join', to: 'qa-sign-off',    on: 'QA_SIGN_OFF',
    guard: Guard.inject('qa-lead') })
  .addTransition({ from: 'qa-sign-off',             to: 'approvals-fork', on: 'START_APPROVALS' })

  // Phase 6 — approvals
  .addTransition({ from: 'engineering-approval', to: 'engineering-approved', on: 'ENGINEERING_APPROVED',
    guard: Guard.inject('engineering-director') })
  .addTransition({ from: 'security-approval',    to: 'security-approved',    on: 'SECURITY_APPROVED',
    guard: securityApprovalGuard })
  .addTransition({ from: 'product-approval',     to: 'product-approved',     on: 'PRODUCT_APPROVED',
    guard: Guard.inject('product-director') })

  .addTransition({ from: 'approvals-join', to: 'prod-deploy-fork', on: 'BEGIN_PROD_ROLLOUT' })

  // Phase 7 — prod deploy
  .addTransition({ from: 'prod-eu',   to: 'prod-eu-up',   on: 'PROD_EU_DEPLOYED' })
  .addTransition({ from: 'prod-us',   to: 'prod-us-up',   on: 'PROD_US_DEPLOYED' })
  .addTransition({ from: 'prod-apac', to: 'prod-apac-up', on: 'PROD_APAC_DEPLOYED' })

  .addTransition({ from: 'prod-deploy-join', to: 'prod-validation-fork', on: 'START_PROD_VALIDATION' })

  // Phase 8 — prod validation
  .addTransition({ from: 'prod-eu-smoke',   to: 'prod-eu-smoke-ok',   on: 'PROD_EU_SMOKE_OK' })
  .addTransition({ from: 'prod-us-smoke',   to: 'prod-us-smoke-ok',   on: 'PROD_US_SMOKE_OK' })
  .addTransition({ from: 'prod-apac-smoke', to: 'prod-apac-smoke-ok', on: 'PROD_APAC_SMOKE_OK' })

  // Observation — after resolveWait('monitoring-system'), dispatch CONFIRM_RELEASE
  .addTransition({ from: 'prod-validation-join', to: 'observation', on: 'BEGIN_OBSERVATION' })
  .addTransition({ from: 'observation',          to: 'released',    on: 'CONFIRM_RELEASE',
    guard: releaseConfirmGuard })

  // Rollback — available from post-staging phases
  .addTransition({ from: 'staging-validation-join', to: 'rolled-back', on: 'ROLLBACK' })
  .addTransition({ from: 'prod-deploy-join',        to: 'rolled-back', on: 'ROLLBACK' })
  .addTransition({ from: 'prod-validation-join',    to: 'rolled-back', on: 'ROLLBACK' })
  .addTransition({ from: 'observation',             to: 'rolled-back', on: 'ROLLBACK' })

  // Cancel — available from early phases before staging
  .addTransition({ from: 'draft',           to: 'cancelled', on: 'CANCEL' })
  .addTransition({ from: 'pre-checks-join', to: 'cancelled', on: 'CANCEL' })
  .addTransition({ from: 'builds-join',     to: 'cancelled', on: 'CANCEL' })

  .build();

export type ReleasePipelineInstance = ReturnType<typeof releasePipelineWorkflow.createInstance>;
