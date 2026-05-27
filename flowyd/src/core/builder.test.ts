import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { createWorkflow } from './builder.js';

function minimalBuilder() {
  return createWorkflow({ name: 'test' })
    .defineAction('GO', z.object({}))
    .addStep('start')
    .addStep('end')
    .setInitial('start')
    .setTerminal(['end'])
    .addTransition({ from: 'start', to: 'end', on: 'GO' });
}

describe('WorkflowBuilder', () => {
  it('builds a valid workflow without throwing', () => {
    expect(() => minimalBuilder().build()).not.toThrow();
  });

  it('throws when no initial state is declared', () => {
    const b = createWorkflow({ name: 'test' })
      .defineAction('GO', z.object({}))
      .addStep('start')
      .setTerminal(['start']);
    expect(() => b.build()).toThrow('initial state');
  });

  it('throws when no terminal state is declared', () => {
    const b = createWorkflow({ name: 'test' })
      .defineAction('GO', z.object({}))
      .addStep('start')
      .setInitial('start');
    expect(() => b.build()).toThrow('terminal state');
  });

  it('throws when a transition references an unregistered state', () => {
    const b = createWorkflow({ name: 'test' })
      .defineAction('GO', z.object({}))
      .addStep('start')
      .setInitial('start')
      .setTerminal(['start'])
      // @ts-expect-error — intentional: verifying runtime fallback for a type-bypassed invalid state ID
      .addTransition({ from: 'start', to: 'ghost', on: 'GO' });
    expect(() => b.build()).toThrow('"ghost"');
  });

  it('throws when a transition uses an undeclared action', () => {
    const b = createWorkflow({ name: 'test' })
      .addStep('start')
      .addStep('end')
      .setInitial('start')
      .setTerminal(['end'])
      // @ts-expect-error — intentional: verifying runtime fallback for a type-bypassed undeclared action
      .addTransition({ from: 'start', to: 'end', on: 'UNDECLARED' });
    expect(() => b.build()).toThrow('UNDECLARED');
  });

  it('throws when a ForkState target is unregistered', () => {
    const b = createWorkflow({ name: 'test' })
      .defineAction('GO', z.object({}))
      .addStep('start')
      // @ts-expect-error — intentional: 'ghost' is not in TStates; verifies build() runtime check
      .addFork('fork', { targets: ['ghost'] })
      .setInitial('start')
      .setTerminal(['start'])
      .addTransition({ from: 'start', to: 'fork', on: 'GO' });
    expect(() => b.build()).toThrow('"ghost"');
  });

  it('throws when a JoinState requires an unregistered state', () => {
    const b = createWorkflow({ name: 'test' })
      .defineAction('GO', z.object({}))
      .addStep('start')
      // @ts-expect-error — intentional: 'ghost' is not in TStates; verifies build() runtime check
      .addJoin('join', { requires: ['ghost'] })
      .setInitial('start')
      .setTerminal(['join'])
      .addTransition({ from: 'start', to: 'join', on: 'GO' });
    expect(() => b.build()).toThrow('"ghost"');
  });

  it('accumulates TActions generics correctly', () => {
    const workflow = createWorkflow({ name: 'typed' })
      .defineAction('SUBMIT', z.object({ submitterId: z.string() }))
      .defineAction('APPROVE', z.object({ reason: z.string() }))
      .addStep('draft')
      .addStep('done')
      .setInitial('draft')
      .setTerminal(['done'])
      .addTransition({ from: 'draft', to: 'done', on: 'SUBMIT' })
      .build();

    // If TActions inference is broken this line won't compile
    const instance = workflow.createInstance('i1');
    expect(instance).toBeDefined();
  });

  it('declared states constrain setInitial/setTerminal/addTransition', () => {
    // Compile-time proof: if TStates is not correctly inferred from the constructor,
    // the calls below produce TypeScript errors because the literal IDs are unknown.
    const workflow = createWorkflow({ name: 'typed-states' })
      .defineAction('GO', z.object({}))
      .addStep('alpha')
      .addStep('beta')
      .setInitial('alpha')
      .setTerminal(['beta'])
      .addTransition({ from: 'alpha', to: 'beta', on: 'GO' })
      .build();

    expect(workflow).toBeDefined();
  });

  it('addFork constrains targets to declared state IDs', () => {
    const workflow = createWorkflow({ name: 'fork-typed' })
      .defineAction('GO', z.object({}))
      .addStep('start')
      .addStep('branch-a')
      .addStep('branch-b')
      .addFork('fork', { targets: ['branch-a', 'branch-b'] })
      .addStep('done')
      .setInitial('start')
      .setTerminal(['done'])
      .addTransition({ from: 'start', to: 'fork', on: 'GO' })
      .build();

    expect(workflow).toBeDefined();
  });

  it('addJoin constrains requires to declared state IDs', () => {
    const workflow = createWorkflow({ name: 'join-typed' })
      .defineAction('START', z.object({}))
      .defineAction('MECH_OK', z.object({}))
      .defineAction('ELEC_OK', z.object({}))
      .defineAction('SAFETY_OK', z.object({}))
      .defineAction('SIGN_OFF', z.object({}))
      .addStep('start')
      .addStep('mechanical')
      .addStep('electrical')
      .addStep('safety-systems')
      .addFork('fork', { targets: ['mechanical', 'electrical', 'safety-systems'] })
      // requires autocompletes to the accumulated TStates union:
      .addJoin('all-clear', {
        requires: ['mechanical', 'electrical', 'safety-systems'],
        mode: 'all',
      })
      .addStep('done')
      .setInitial('start')
      .setTerminal(['done'])
      .addTransition({ from: 'start', to: 'fork', on: 'START' })
      .addTransition({ from: 'mechanical', to: 'all-clear', on: 'MECH_OK' })
      .addTransition({ from: 'electrical', to: 'all-clear', on: 'ELEC_OK' })
      .addTransition({ from: 'safety-systems', to: 'all-clear', on: 'SAFETY_OK' })
      .addTransition({ from: 'all-clear', to: 'done', on: 'SIGN_OFF' })
      .build();

    expect(workflow).toBeDefined();
  });

  it('infers guard payload type from the action schema', () => {
    // Compile-time proof: ctx.payload is typed as { score: number } without annotation.
    const workflow = createWorkflow({ name: 'guard-inference' })
      .defineAction('SCORE', z.object({ score: z.number() }))
      .addStep('pending')
      .addStep('passed')
      .setInitial('pending')
      .setTerminal(['passed'])
      .addTransition({
        from: 'pending',
        to: 'passed',
        on: 'SCORE',
        guard: (ctx) => ctx.payload.score >= 80,
      })
      .build();

    expect(workflow).toBeDefined();
  });
});
