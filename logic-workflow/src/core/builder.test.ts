import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { WorkflowBuilder } from './builder.js';
import { StepState } from '../states/step-state.js';
import { ForkState } from '../states/fork-state.js';
import { JoinState } from '../states/join-state.js';

function minimalBuilder() {
  return new WorkflowBuilder('test')
    .defineAction('GO', z.object({}))
    .addState(new StepState('start'))
    .addState(new StepState('end'))
    .setInitial('start')
    .setTerminal(['end'])
    .addTransition({ from: 'start', to: 'end', on: 'GO' });
}

describe('WorkflowBuilder', () => {
  it('builds a valid workflow without throwing', () => {
    expect(() => minimalBuilder().build()).not.toThrow();
  });

  it('throws when no initial state is declared', () => {
    const b = new WorkflowBuilder('test')
      .defineAction('GO', z.object({}))
      .addState(new StepState('start'))
      .setTerminal(['start']);
    expect(() => b.build()).toThrow('initial state');
  });

  it('throws when no terminal state is declared', () => {
    const b = new WorkflowBuilder('test')
      .defineAction('GO', z.object({}))
      .addState(new StepState('start'))
      .setInitial('start');
    expect(() => b.build()).toThrow('terminal state');
  });

  it('throws when a transition references an unregistered state', () => {
    const b = new WorkflowBuilder('test')
      .defineAction('GO', z.object({}))
      .addState(new StepState('start'))
      .setInitial('start')
      .setTerminal(['start'])
      // @ts-expect-error — intentional: verifying runtime fallback for a type-bypassed invalid state ID
      .addTransition({ from: 'start', to: 'ghost', on: 'GO' });
    expect(() => b.build()).toThrow('"ghost"');
  });

  it('throws when a transition uses an undeclared action', () => {
    const b = new WorkflowBuilder('test')
      .addState(new StepState('start'))
      .addState(new StepState('end'))
      .setInitial('start')
      .setTerminal(['end'])
      // @ts-expect-error — intentional: verifying runtime fallback for a type-bypassed undeclared action
      .addTransition({ from: 'start', to: 'end', on: 'UNDECLARED' });
    expect(() => b.build()).toThrow('UNDECLARED');
  });

  it('throws when a ForkState target is unregistered', () => {
    const b = new WorkflowBuilder('test')
      .defineAction('GO', z.object({}))
      .addState(new StepState('start'))
      .addState(new ForkState('fork', { targets: ['ghost'] }))
      .setInitial('start')
      .setTerminal(['start'])
      .addTransition({ from: 'start', to: 'fork', on: 'GO' });
    expect(() => b.build()).toThrow('"ghost"');
  });

  it('throws when a JoinState requires an unregistered state', () => {
    const b = new WorkflowBuilder('test')
      .defineAction('GO', z.object({}))
      .addState(new StepState('start'))
      .addState(new JoinState('join', { requires: ['ghost'] }))
      .setInitial('start')
      .setTerminal(['join'])
      .addTransition({ from: 'start', to: 'join', on: 'GO' });
    expect(() => b.build()).toThrow('"ghost"');
  });

  it('accumulates TActions generics correctly', () => {
    const workflow = new WorkflowBuilder('typed')
      .defineAction('SUBMIT', z.object({ submitterId: z.string() }))
      .defineAction('APPROVE', z.object({ reason: z.string() }))
      .addState(new StepState('draft'))
      .addState(new StepState('done'))
      .setInitial('draft')
      .setTerminal(['done'])
      .addTransition({ from: 'draft', to: 'done', on: 'SUBMIT' })
      .build();

    // If TActions inference is broken this line won't compile
    const instance = workflow.createInstance('i1');
    expect(instance).toBeDefined();
  });

  it('accumulates TStates generics and constrains setInitial/setTerminal/addTransition', () => {
    // Compile-time proof: if TStates accumulation is broken, the calls below
    // produce TypeScript errors because the literal IDs are not in TStates.
    const workflow = new WorkflowBuilder('typed-states')
      .defineAction('GO', z.object({}))
      .addState(new StepState('alpha'))
      .addState(new StepState('beta'))
      .setInitial('alpha')
      .setTerminal(['beta'])
      .addTransition({ from: 'alpha', to: 'beta', on: 'GO' })
      .build();

    expect(workflow).toBeDefined();
  });

  it('infers guard payload type from the action schema', () => {
    // Compile-time proof: ctx.payload is typed as { score: number } without annotation.
    const workflow = new WorkflowBuilder('guard-inference')
      .defineAction('SCORE', z.object({ score: z.number() }))
      .addState(new StepState('pending'))
      .addState(new StepState('passed'))
      .setInitial('pending')
      .setTerminal(['passed'])
      .addTransition({
        from: 'pending',
        to:   'passed',
        on:   'SCORE',
        guard: (ctx) => ctx.payload.score >= 80,
      })
      .build();

    expect(workflow).toBeDefined();
  });
});
