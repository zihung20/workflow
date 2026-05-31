import { z } from 'zod';
import { createWorkflow, Guard } from 'flowyd';

/**
 * Multi-environment production release pipeline for a microservices platform.
 *
 * Demonstrates: setContext, 50-state TStates union, 8 parallel fork/join phases,
 * WaitState observation period, inline payload guards, context-aware Guard.fn,
 * Guard.and / Guard.inject combinators, and ReturnType instance typing.
 *
 * Flow:
 *   draft
 *     → [pre-checks ×5: change-ticket | design | security | dep-audit | license]
 *     → [builds ×4: api | frontend | worker | infra]
 *     → [tests ×4: unit | integration | e2e | load]
 *     → [staging-deploy ×3] → [staging-validation ×3] → qa-sign-off
 *     → [approvals ×3: engineering | security | product]
 *     → [prod-deploy ×3: eu | us | apac] → [prod-validation ×3]
 *     → observation (WaitState — resolveWait('monitoring-system') + CONFIRM_RELEASE)
 *     → released ✓
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

// Score threshold varies by release type: major needs 90+, all others 75+.
const securityScoreGuard = Guard.fn<
  z.infer<typeof SecurityReviewSchema>,
  z.infer<typeof ReleaseContextSchema>
>((ctx) => {
  const threshold = ctx.context.releaseType === 'major' ? 90 : 75;
  return ctx.payload.score >= threshold && ctx.payload.criticalCount === 0;
});

// Infra destroys are blocked on non-emergency releases — too risky to automate.
const infraDestroyGuard = Guard.fn<
  z.infer<typeof InfraPlanSchema>,
  z.infer<typeof ReleaseContextSchema>
>((ctx) => ctx.context.isEmergency || ctx.payload.destroyCount === 0);

// Security approval requires director sign-off AND the assessed risk must not be 'high'.
const securityApprovalGuard = Guard.and([
  Guard.inject('security-director'),
  Guard.fn<z.infer<typeof RiskApprovalSchema>>((ctx) => ctx.payload.riskLevel !== 'high'),
]);

// Final confirmation requires CTO sign-off AND fewer than 5 alerts during observation.
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

  // Phase 1 — pre-checks (branches must precede their fork)
  .addStep('change-ticket-review', { label: 'Change Ticket Review' })
  .addStep('design-review',        { label: 'Design Review' })
  .addStep('security-review',      { label: 'Security Review' })
  .addStep('dependency-audit',     { label: 'Dependency Audit' })
  .addStep('license-scan',         { label: 'License Scan' })
  .addFork('pre-checks-fork', { label: 'Pre-checks Fork',
    targets: ['change-ticket-review', 'design-review', 'security-review', 'dependency-audit', 'license-scan'] })
  .addJoin('pre-checks-join', { label: 'Pre-checks Complete',
    requires: ['change-ticket-review', 'design-review', 'security-review', 'dependency-audit', 'license-scan'], mode: 'all' })

  // Phase 2 — builds
  .addStep('api-build',      { label: 'API Build' })
  .addStep('frontend-build', { label: 'Frontend Build' })
  .addStep('worker-build',   { label: 'Worker Build' })
  .addStep('infra-plan',     { label: 'Infrastructure Plan' })
  .addFork('builds-fork', { label: 'Builds Fork',
    targets: ['api-build', 'frontend-build', 'worker-build', 'infra-plan'] })
  .addJoin('builds-join', { label: 'Builds Complete',
    requires: ['api-build', 'frontend-build', 'worker-build', 'infra-plan'], mode: 'all' })

  // Phase 3 — tests
  .addStep('unit-tests',        { label: 'Unit Tests' })
  .addStep('integration-tests', { label: 'Integration Tests' })
  .addStep('e2e-tests',         { label: 'E2E Tests' })
  .addStep('load-tests',        { label: 'Load Tests' })
  .addFork('tests-fork', { label: 'Tests Fork',
    targets: ['unit-tests', 'integration-tests', 'e2e-tests', 'load-tests'] })
  .addJoin('tests-join', { label: 'Tests Complete',
    requires: ['unit-tests', 'integration-tests', 'e2e-tests', 'load-tests'], mode: 'all' })

  // Phase 4 — staging deploy
  .addStep('staging-api',      { label: 'Staging API' })
  .addStep('staging-frontend', { label: 'Staging Frontend' })
  .addStep('staging-worker',   { label: 'Staging Worker' })
  .addFork('staging-deploy-fork', { label: 'Staging Deploy Fork',
    targets: ['staging-api', 'staging-frontend', 'staging-worker'] })
  .addJoin('staging-deploy-join', { label: 'Staging Deploy Complete',
    requires: ['staging-api', 'staging-frontend', 'staging-worker'], mode: 'all' })

  // Phase 5 — staging validation
  .addStep('staging-smoke',       { label: 'Staging Smoke Tests' })
  .addStep('staging-regression',  { label: 'Staging Regression Tests' })
  .addStep('staging-performance', { label: 'Staging Performance Tests' })
  .addFork('staging-validation-fork', { label: 'Staging Validation Fork',
    targets: ['staging-smoke', 'staging-regression', 'staging-performance'] })
  .addJoin('staging-validation-join', { label: 'Staging Validation Complete',
    requires: ['staging-smoke', 'staging-regression', 'staging-performance'], mode: 'all' })

  // Phase 6 — QA gate + approvals
  .addStep('qa-sign-off',          { label: 'QA Sign-off' })
  .addStep('engineering-approval', { label: 'Engineering Approval' })
  .addStep('security-approval',    { label: 'Security Approval' })
  .addStep('product-approval',     { label: 'Product Approval' })
  .addFork('approvals-fork', { label: 'Approvals Fork',
    targets: ['engineering-approval', 'security-approval', 'product-approval'] })
  .addJoin('approvals-join', { label: 'All Approvals Received',
    requires: ['engineering-approval', 'security-approval', 'product-approval'], mode: 'all' })

  // Phase 7 — production deploy (multi-region)
  .addStep('prod-eu',   { label: 'Prod EU Deploy' })
  .addStep('prod-us',   { label: 'Prod US Deploy' })
  .addStep('prod-apac', { label: 'Prod APAC Deploy' })
  .addFork('prod-deploy-fork', { label: 'Prod Deploy Fork',
    targets: ['prod-eu', 'prod-us', 'prod-apac'] })
  .addJoin('prod-deploy-join', { label: 'Prod Deploy Complete',
    requires: ['prod-eu', 'prod-us', 'prod-apac'], mode: 'all' })

  // Phase 8 — production validation
  .addStep('prod-eu-smoke',   { label: 'Prod EU Smoke' })
  .addStep('prod-us-smoke',   { label: 'Prod US Smoke' })
  .addStep('prod-apac-smoke', { label: 'Prod APAC Smoke' })
  .addFork('prod-validation-fork', { label: 'Prod Validation Fork',
    targets: ['prod-eu-smoke', 'prod-us-smoke', 'prod-apac-smoke'] })
  .addJoin('prod-validation-join', { label: 'Prod Validation Complete',
    requires: ['prod-eu-smoke', 'prod-us-smoke', 'prod-apac-smoke'], mode: 'all' })

  // Phase 9 — observation (external monitoring resolves this, then service dispatches CONFIRM_RELEASE)
  .addWait('observation', { label: 'Observation Period', externalName: 'monitoring-system' })

  .setInitial('draft')
  .setTerminal(['released', 'rolled-back', 'cancelled'])

  // ── Transitions ───────────────────────────────────────────────────────────────

  .addTransition({ from: 'draft', to: 'pre-checks-fork', on: 'SUBMIT' })

  // Pre-checks — each branch has its own completion guard
  .addTransition({ from: 'change-ticket-review', to: 'pre-checks-join', on: 'APPROVE_CHANGE_TICKET' })
  .addTransition({ from: 'design-review',        to: 'pre-checks-join', on: 'APPROVE_DESIGN' })
  .addTransition({ from: 'security-review',      to: 'pre-checks-join', on: 'APPROVE_SECURITY_REVIEW',
    guard: securityScoreGuard })
  .addTransition({ from: 'dependency-audit',     to: 'pre-checks-join', on: 'COMPLETE_DEP_AUDIT',
    guard: (ctx) => ctx.payload.criticalCount === 0 })
  .addTransition({ from: 'license-scan',         to: 'pre-checks-join', on: 'COMPLETE_LICENSE_SCAN',
    guard: (ctx) => ctx.payload.blockerCount === 0 })

  .addTransition({ from: 'pre-checks-join', to: 'builds-fork', on: 'START_BUILDS' })

  // Builds — infra destroys are blocked on non-emergency releases
  .addTransition({ from: 'api-build',      to: 'builds-join', on: 'BUILD_API_DONE' })
  .addTransition({ from: 'frontend-build', to: 'builds-join', on: 'BUILD_FRONTEND_DONE' })
  .addTransition({ from: 'worker-build',   to: 'builds-join', on: 'BUILD_WORKER_DONE' })
  .addTransition({ from: 'infra-plan',     to: 'builds-join', on: 'PLAN_INFRA_DONE',
    guard: infraDestroyGuard })

  .addTransition({ from: 'builds-join', to: 'tests-fork', on: 'START_TESTS' })

  // Tests — zero failures required; load tests enforce latency and error-rate SLOs
  .addTransition({ from: 'unit-tests',        to: 'tests-join', on: 'UNIT_TESTS_PASSED',
    guard: (ctx) => ctx.payload.failed === 0 })
  .addTransition({ from: 'integration-tests', to: 'tests-join', on: 'INTEGRATION_TESTS_PASSED',
    guard: (ctx) => ctx.payload.failed === 0 })
  .addTransition({ from: 'e2e-tests',         to: 'tests-join', on: 'E2E_TESTS_PASSED',
    guard: (ctx) => ctx.payload.failed === 0 })
  .addTransition({ from: 'load-tests',        to: 'tests-join', on: 'LOAD_TESTS_PASSED',
    guard: (ctx) => ctx.payload.p99Ms < 200 && ctx.payload.p999Ms < 800 && ctx.payload.errorRate < 0.01 })

  .addTransition({ from: 'tests-join', to: 'staging-deploy-fork', on: 'DEPLOY_TO_STAGING' })

  .addTransition({ from: 'staging-api',      to: 'staging-deploy-join', on: 'STAGING_API_UP' })
  .addTransition({ from: 'staging-frontend', to: 'staging-deploy-join', on: 'STAGING_FRONTEND_UP' })
  .addTransition({ from: 'staging-worker',   to: 'staging-deploy-join', on: 'STAGING_WORKER_UP' })

  .addTransition({ from: 'staging-deploy-join', to: 'staging-validation-fork', on: 'START_STAGING_VALIDATION' })

  // Staging validation — perf must not regress more than 15% against baseline
  .addTransition({ from: 'staging-smoke',       to: 'staging-validation-join', on: 'STAGING_SMOKE_OK' })
  .addTransition({ from: 'staging-regression',  to: 'staging-validation-join', on: 'STAGING_REGRESSION_OK',
    guard: (ctx) => ctx.payload.failed === 0 })
  .addTransition({ from: 'staging-performance', to: 'staging-validation-join', on: 'STAGING_PERFORMANCE_OK',
    guard: (ctx) => ctx.payload.p99Ms < 200 && ctx.payload.baselineRatio < 1.15 })

  // QA gate — injected qa-lead must approve before approvals phase opens
  .addTransition({ from: 'staging-validation-join', to: 'qa-sign-off',     on: 'QA_SIGN_OFF',
    guard: Guard.inject('qa-lead') })
  .addTransition({ from: 'qa-sign-off',             to: 'approvals-fork',  on: 'START_APPROVALS' })

  // Approvals — security uses Guard.and (director + risk level check)
  .addTransition({ from: 'engineering-approval', to: 'approvals-join', on: 'ENGINEERING_APPROVED',
    guard: Guard.inject('engineering-director') })
  .addTransition({ from: 'security-approval',    to: 'approvals-join', on: 'SECURITY_APPROVED',
    guard: securityApprovalGuard })
  .addTransition({ from: 'product-approval',     to: 'approvals-join', on: 'PRODUCT_APPROVED',
    guard: Guard.inject('product-director') })

  .addTransition({ from: 'approvals-join', to: 'prod-deploy-fork', on: 'BEGIN_PROD_ROLLOUT' })

  .addTransition({ from: 'prod-eu',   to: 'prod-deploy-join', on: 'PROD_EU_DEPLOYED' })
  .addTransition({ from: 'prod-us',   to: 'prod-deploy-join', on: 'PROD_US_DEPLOYED' })
  .addTransition({ from: 'prod-apac', to: 'prod-deploy-join', on: 'PROD_APAC_DEPLOYED' })

  .addTransition({ from: 'prod-deploy-join', to: 'prod-validation-fork', on: 'START_PROD_VALIDATION' })

  .addTransition({ from: 'prod-eu-smoke',   to: 'prod-validation-join', on: 'PROD_EU_SMOKE_OK' })
  .addTransition({ from: 'prod-us-smoke',   to: 'prod-validation-join', on: 'PROD_US_SMOKE_OK' })
  .addTransition({ from: 'prod-apac-smoke', to: 'prod-validation-join', on: 'PROD_APAC_SMOKE_OK' })

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
  .addTransition({ from: 'draft',          to: 'cancelled', on: 'CANCEL' })
  .addTransition({ from: 'pre-checks-join', to: 'cancelled', on: 'CANCEL' })
  .addTransition({ from: 'builds-join',    to: 'cancelled', on: 'CANCEL' })

  .build();

export type ReleasePipelineInstance = ReturnType<typeof releasePipelineWorkflow.createInstance>;
