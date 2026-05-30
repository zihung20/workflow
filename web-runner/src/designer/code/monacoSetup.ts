import type { Monaco } from '@monaco-editor/react';

const FLOWYD_TYPES = `
declare module 'flowyd' {
  import type { ZodSchema } from 'zod';

  export enum StateKind { Step = 'step', Fork = 'fork', Join = 'join', Wait = 'wait' }
  export enum StateStatus { Idle = 'idle', Active = 'active', Waiting = 'waiting', Completed = 'completed' }

  export type JoinMode = 'all' | 'any' | number;

  export interface ReadonlyInstanceState<TStates extends string = string> {
    isStateCompleted(id: TStates): boolean;
    isStateActive(id: TStates): boolean;
  }

  export interface GuardContext<TPayload, TContext = unknown, TStates extends string = string> {
    readonly payload: TPayload;
    readonly context: TContext;
    readonly instanceState: ReadonlyInstanceState<TStates>;
  }

  export type GuardFn<TPayload, TContext = unknown> =
    (ctx: GuardContext<TPayload, TContext>) => boolean | Promise<boolean>;

  export interface IGuard<TPayload = unknown> {
    evaluate(ctx: GuardContext<TPayload>): Promise<boolean>;
  }

  export declare namespace Guard {
    function fn<TPayload>(fn: GuardFn<TPayload>): IGuard<TPayload>;
    function inject(name: string): IGuard;
    function always(): IGuard;
    function never(): IGuard;
    function and(...guards: IGuard[]): IGuard;
    function or(...guards: IGuard[]): IGuard;
    function not(guard: IGuard): IGuard;
    function stateCompleted(id: string): IGuard;
    function stateActive(id: string): IGuard;
  }

  export interface AnyState {
    readonly id: string;
    readonly kind: StateKind;
    readonly label: string;
  }

  export interface TransitionDefinition {
    readonly from: string;
    readonly to: string;
    readonly on: string;
    readonly guard?: IGuard;
  }

  export interface WorkflowDefinition<TContext = unknown, TStates extends string = string> {
    readonly name: string;
    readonly states: ReadonlyMap<TStates, AnyState>;
    readonly transitions: readonly TransitionDefinition[];
    readonly actionSchemas: ReadonlyMap<string, ZodSchema<unknown>>;
    readonly initialStateId: TStates;
    readonly terminalStateIds: readonly TStates[];
    readonly contextSchema?: ZodSchema<TContext>;
  }

  export type DispatchResult =
    | { success: true; action: string }
    | { success: false; reason: string; action: string };

  export interface InstanceSnapshot<TContext = unknown, TStates extends string = string> {
    readonly instanceId: string;
    readonly workflowName: string;
    readonly version: number;
    readonly stateStatuses: Record<string, string>;
    readonly isTerminal: boolean;
    readonly history: unknown[];
    readonly createdAt: string;
    readonly updatedAt: string;
  }

  export declare class WorkflowInstance<
    TActions = Record<string, unknown>,
    TContext = unknown,
    TStates extends string = string,
  > {
    dispatch(action: keyof TActions & string, payload: unknown): Promise<DispatchResult>;
    getSnapshot(): InstanceSnapshot<TContext, TStates>;
    injectGuard(name: string, fn: GuardFn<unknown>): this;
    setContext(ctx: TContext): this;
    getContext(): TContext;
  }

  export declare class Workflow<
    TActions = Record<never, never>,
    TStates extends string = string,
    TContext = unknown,
  > {
    createInstance(id: string, ...ctx: unknown[]): WorkflowInstance<TActions, TContext, TStates>;
    restoreInstance(snapshot: InstanceSnapshot): WorkflowInstance<TActions, TContext, TStates>;
    getDefinition(): WorkflowDefinition<TContext, TStates>;
  }

  export declare class WorkflowBuilder<
    TActions = Record<never, never>,
    TStates extends string = never,
    TContext = unknown,
  > {
    defineAction<K extends string, T>(name: K, schema: ZodSchema<T>): WorkflowBuilder<TActions & Record<K, T>, TStates, TContext>;
    addStep<K extends string>(id: K, options?: { label?: string }): WorkflowBuilder<TActions, TStates | K, TContext>;
    addFork<K extends string>(id: K, options: { label?: string; targets: (TStates extends never ? string : TStates)[] }): WorkflowBuilder<TActions, TStates | K, TContext>;
    addJoin<K extends string>(id: K, options: { label?: string; requires: (TStates extends never ? string : TStates)[]; mode?: JoinMode }): WorkflowBuilder<TActions, TStates | K, TContext>;
    addWait<K extends string>(id: K, options?: { label?: string; externalName?: string }): WorkflowBuilder<TActions, TStates | K, TContext>;
    setContext<C>(schema: ZodSchema<C>): WorkflowBuilder<TActions, TStates, C>;
    setInitial(id: TStates extends never ? string : TStates): this;
    setTerminal(ids: (TStates extends never ? string : TStates) | (TStates extends never ? string : TStates)[]): this;
    addTransition(config: {
      from: TStates extends never ? string : TStates;
      to: TStates extends never ? string : TStates;
      on: keyof TActions extends never ? string : keyof TActions & string;
      guard?: GuardFn<unknown> | IGuard;
    }): this;
    build(): Workflow<TActions, TStates, TContext>;
  }

  export declare function createWorkflow(config: { name: string }): WorkflowBuilder;
  export declare function createDynamicWorkflow(config: { name: string }): WorkflowBuilder<Record<string, unknown>, string>;
}
`;

const ZOD_TYPES = `
declare module 'zod' {
  export type ZodRawShape = Record<string, ZodTypeAny>;
  export type ZodTypeAny = ZodType<unknown>;

  export abstract class ZodType<Output = unknown, Input = Output> {
    _type: Output;
    _input: Input;
    optional(): ZodOptional<this>;
    nullable(): ZodNullable<this>;
    array(): ZodArray<this>;
    describe(description: string): this;
    default(def: Output): ZodDefault<this>;
    parse(data: unknown): Output;
    safeParse(data: unknown): { success: true; data: Output } | { success: false; error: ZodError };
  }

  export class ZodString extends ZodType<string> {
    min(len: number, msg?: string): ZodString;
    max(len: number, msg?: string): ZodString;
    length(len: number): ZodString;
    email(): ZodString;
    url(): ZodString;
    uuid(): ZodString;
    nonempty(): ZodString;
    trim(): ZodString;
    regex(re: RegExp): ZodString;
    includes(s: string): ZodString;
    startsWith(s: string): ZodString;
    endsWith(s: string): ZodString;
  }

  export class ZodNumber extends ZodType<number> {
    int(): ZodNumber;
    min(n: number): ZodNumber;
    max(n: number): ZodNumber;
    positive(): ZodNumber;
    negative(): ZodNumber;
    nonnegative(): ZodNumber;
    finite(): ZodNumber;
    gt(n: number): ZodNumber;
    gte(n: number): ZodNumber;
    lt(n: number): ZodNumber;
    lte(n: number): ZodNumber;
  }

  export class ZodBoolean extends ZodType<boolean> {}
  export class ZodDate extends ZodType<Date> {}
  export class ZodNull extends ZodType<null> {}
  export class ZodUndefined extends ZodType<undefined> {}
  export class ZodUnknown extends ZodType<unknown> {}
  export class ZodAny extends ZodType<unknown> {}

  export class ZodLiteral<T extends string | number | boolean | null | undefined> extends ZodType<T> {}

  export class ZodEnum<T extends [string, ...string[]]> extends ZodType<T[number]> {
    enum: { [K in T[number]]: K };
    options: T;
  }

  export class ZodNativeEnum<T extends Record<string, string | number>> extends ZodType<T[keyof T]> {}

  export type ZodObjectShape<T extends ZodRawShape> = {
    [K in keyof T]: T[K];
  };

  export class ZodObject<T extends ZodRawShape> extends ZodType<{
    [K in keyof T]: T[K] extends ZodType<infer U> ? U : never;
  }> {
    shape: T;
    extend<A extends ZodRawShape>(augmentation: A): ZodObject<T & A>;
    merge<A extends ZodRawShape>(other: ZodObject<A>): ZodObject<T & A>;
    pick<K extends keyof T>(keys: { [P in K]: true }): ZodObject<Pick<T, K>>;
    omit<K extends keyof T>(keys: { [P in K]: true }): ZodObject<Omit<T, K>>;
    partial(): ZodObject<{ [K in keyof T]: ZodOptional<T[K]> }>;
    required(): ZodObject<{ [K in keyof T]: ZodType<NonNullable<T[K] extends ZodType<infer U> ? U : never>> }>;
    strict(): this;
    passthrough(): this;
  }

  export class ZodArray<T extends ZodTypeAny> extends ZodType<T['_type'][]> {
    element: T;
    min(n: number): ZodArray<T>;
    max(n: number): ZodArray<T>;
    length(n: number): ZodArray<T>;
    nonempty(): ZodArray<T>;
  }

  export class ZodUnion<T extends readonly [ZodTypeAny, ...ZodTypeAny[]]> extends ZodType<T[number]['_type']> {}
  export class ZodIntersection<A extends ZodTypeAny, B extends ZodTypeAny> extends ZodType<A['_type'] & B['_type']> {}
  export class ZodTuple<T extends [ZodTypeAny, ...ZodTypeAny[]]> extends ZodType<{ [I in keyof T]: T[I] extends ZodTypeAny ? T[I]['_type'] : never }> {}
  export class ZodRecord<V extends ZodTypeAny = ZodTypeAny> extends ZodType<Record<string, V['_type']>> {}
  export class ZodMap<K extends ZodTypeAny = ZodTypeAny, V extends ZodTypeAny = ZodTypeAny> extends ZodType<Map<K['_type'], V['_type']>> {}
  export class ZodSet<T extends ZodTypeAny = ZodTypeAny> extends ZodType<Set<T['_type']>> {}
  export class ZodOptional<T extends ZodTypeAny> extends ZodType<T['_type'] | undefined> {}
  export class ZodNullable<T extends ZodTypeAny> extends ZodType<T['_type'] | null> {}
  export class ZodDefault<T extends ZodTypeAny> extends ZodType<NonNullable<T['_type']>> {}
  export class ZodPromise<T extends ZodTypeAny> extends ZodType<Promise<T['_type']>> {}

  export class ZodError extends Error {
    issues: { message: string; path: (string | number)[] }[];
  }

  export type infer<T extends ZodType> = T['_type'];
  export type ZodSchema<T = unknown> = ZodType<T>;

  export function string(): ZodString;
  export function number(): ZodNumber;
  export function boolean(): ZodBoolean;
  export function date(): ZodDate;
  export function null_(): ZodNull;
  export { null_ as null };
  export function undefined_(): ZodUndefined;
  export { undefined_ as undefined };
  export function unknown(): ZodUnknown;
  export function any(): ZodAny;
  export function literal<T extends string | number | boolean | null>(value: T): ZodLiteral<T>;
  export function enum_<T extends [string, ...string[]]>(values: T): ZodEnum<T>;
  export { enum_ as enum };
  export function nativeEnum<T extends Record<string, string | number>>(e: T): ZodNativeEnum<T>;
  export function object<T extends ZodRawShape>(shape: T): ZodObject<T>;
  export function array<T extends ZodTypeAny>(schema: T): ZodArray<T>;
  export function union<T extends readonly [ZodTypeAny, ...ZodTypeAny[]]>(types: T): ZodUnion<T>;
  export function intersection<A extends ZodTypeAny, B extends ZodTypeAny>(a: A, b: B): ZodIntersection<A, B>;
  export function tuple<T extends [ZodTypeAny, ...ZodTypeAny[]]>(items: T): ZodTuple<T>;
  export function record<V extends ZodTypeAny>(valueType: V): ZodRecord<V>;
  export function map<K extends ZodTypeAny, V extends ZodTypeAny>(keyType: K, valueType: V): ZodMap<K, V>;
  export function set<T extends ZodTypeAny>(valueType: T): ZodSet<T>;
  export function optional<T extends ZodTypeAny>(type: T): ZodOptional<T>;
  export function nullable<T extends ZodTypeAny>(type: T): ZodNullable<T>;
  export function promise<T extends ZodTypeAny>(type: T): ZodPromise<T>;
  export function discriminatedUnion<T extends string, U extends readonly [ZodObject<Record<T, ZodTypeAny>>, ...ZodObject<Record<T, ZodTypeAny>>[]]>(discriminator: T, options: U): ZodUnion<U>;
}
`;

export function setupMonacoTypes(monacoInstance: Monaco): void {
  const ts = monacoInstance.languages.typescript;

  ts.typescriptDefaults.setCompilerOptions({
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    strict: true,
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
    // Include standard browser + ES2020 globals so console, setTimeout, Promise, etc. have types.
    // Without this Monaco defaults to ES5 only.
    lib: ['es2020', 'dom'],
  });

  ts.typescriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
  });

  // Registered at file:/// paths so the TypeScript service can resolve them
  // when the editor model is also at a file:/// URI (see CodeEditor path prop).
  ts.typescriptDefaults.addExtraLib(FLOWYD_TYPES, 'file:///node_modules/flowyd/index.d.ts');
  ts.typescriptDefaults.addExtraLib(ZOD_TYPES,    'file:///node_modules/zod/index.d.ts');
}
