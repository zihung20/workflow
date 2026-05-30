import type { Monaco } from '@monaco-editor/react';
import flowydDts from 'virtual:flowyd-dts';

// Hand-written because zod's real .d.ts files have deep internal cross-imports
// that don't flatten well for Monaco's virtual file system.
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

  /** The \`z\` named export — an object containing all schema factory functions. */
  export namespace z {
    export type ZodRawShape = Record<string, ZodTypeAny>;
    export type ZodTypeAny = ZodType<unknown>;
    export type infer<T extends ZodType> = T['_type'];
    export type ZodSchema<T = unknown> = ZodType<T>;
    export function string(): ZodString;
    export function number(): ZodNumber;
    export function boolean(): ZodBoolean;
    export function date(): ZodDate;
    export function unknown(): ZodUnknown;
    export function any(): ZodAny;
    export function literal<T extends string | number | boolean | null>(value: T): ZodLiteral<T>;
    export function object<T extends ZodRawShape>(shape: T): ZodObject<T>;
    export function array<T extends ZodTypeAny>(schema: T): ZodArray<T>;
    export function union<T extends readonly [ZodTypeAny, ...ZodTypeAny[]]>(types: T): ZodUnion<T>;
    export function tuple<T extends [ZodTypeAny, ...ZodTypeAny[]]>(items: T): ZodTuple<T>;
    export function record<V extends ZodTypeAny>(valueType: V): ZodRecord<V>;
    export function optional<T extends ZodTypeAny>(type: T): ZodOptional<T>;
    export function nullable<T extends ZodTypeAny>(type: T): ZodNullable<T>;
    export function promise<T extends ZodTypeAny>(type: T): ZodPromise<T>;
    export function nativeEnum<T extends Record<string, string | number>>(e: T): ZodNativeEnum<T>;
    export function intersection<A extends ZodTypeAny, B extends ZodTypeAny>(a: A, b: B): ZodIntersection<A, B>;
    export function discriminatedUnion<T extends string>(discriminator: T, options: readonly ZodObject<Record<T, ZodTypeAny>>[]): ZodUnion<readonly [ZodTypeAny, ...ZodTypeAny[]]>;
    export function enum_<T extends [string, ...string[]]>(values: T): ZodEnum<T>;
    export { enum_ as enum };
  }
}
`;

/**
 * Converts a full `z.object({ ... })` expression (or bare field body) to an
 * approximate TypeScript type. Used to feed typed `ctx.payload` / `ctx.context`
 * into the guard editor.
 */
function zodExprToTsType(expr: string): string {
  const trimmed = expr.trim();
  if (!trimmed || trimmed === 'z.object({})') return 'Record<string, unknown>';
  try {
    // Accept both full `z.object({ fields })` and bare `fields` strings.
    const innerMatch = /z\.object\(\s*\{([^}]*)\}\s*\)/.exec(trimmed);
    const body = innerMatch ? (innerMatch[1] ?? trimmed) : trimmed;

    const fields: string[] = [];
    const re = /(\w+)\s*:\s*(z\.\w+\([^)]*\)(?:\.\w+\([^)]*\))*)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) {
      const key = m[1];
      const zodToken = m[2];
      if (!key || !zodToken) continue;
      let tsType = 'unknown';
      if (/^z\.string\(/.test(zodToken))       tsType = 'string';
      else if (/^z\.number\(/.test(zodToken))  tsType = 'number';
      else if (/^z\.boolean\(/.test(zodToken)) tsType = 'boolean';
      else if (/^z\.date\(/.test(zodToken))    tsType = 'Date';
      fields.push(`${key}: ${tsType}`);
    }
    return fields.length > 0 ? `{ ${fields.join('; ')} }` : 'Record<string, unknown>';
  } catch {
    return 'Record<string, unknown>';
  }
}

/**
 * Re-registers the `ctx` global for guard body editors.
 * Calling this with the same URI replaces the previous declaration in-place.
 * @param payloadZodBody - Zod object body for the action's payload schema.
 * @param contextZodBody - Zod object body for the workflow context schema.
 */
export function updateGuardContextTypes(
  monacoInstance: Monaco,
  nodeIds: string[],
  payloadZodBody = '',
  contextZodBody = '',
): void {
  const stateIdUnion = nodeIds.length > 0
    ? nodeIds.map(id => JSON.stringify(id)).join(' | ')
    : 'string';
  const payloadType  = zodExprToTsType(payloadZodBody);
  const contextType  = contextZodBody.trim() ? zodExprToTsType(contextZodBody) : 'unknown';

  // No top-level `import` — keeping this file ambient so `ctx` is a true global.
  // Inline `import()` type syntax resolves GuardContext from the already-loaded flowyd .d.ts.
  monacoInstance.languages.typescript.typescriptDefaults.addExtraLib(
    `declare const ctx: import('flowyd').GuardContext<${payloadType}, ${contextType}, ${stateIdUnion}>;`,
    'file:///guard-context.d.ts',
  );
}

export function setupMonacoTypes(monacoInstance: Monaco): void {
  const ts = monacoInstance.languages.typescript;

  ts.typescriptDefaults.setCompilerOptions({
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    strict: true,
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
    lib: ['es5', 'es2015', 'es2016', 'es2017', 'es2018', 'es2019', 'es2020', 'dom', 'dom.iterable'],
  });

  ts.typescriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
  });

  // Register all flowyd .d.ts files from the real build output.
  // index.d.ts imports chunk files as './workflow-<hash>.js'. Register each chunk
  // at both its .d.ts path AND its .js path so Monaco's TypeScript worker can
  // resolve the import regardless of whether it applies .js→.d.ts substitution.
  for (const { filename, content } of flowydDts) {
    ts.typescriptDefaults.addExtraLib(content, `file:///node_modules/flowyd/${filename}`);
    if (filename !== 'index.d.ts' && filename !== 'index.d.cts') {
      const jsFilename = filename.replace(/\.d\.ts$/, '.js');
      ts.typescriptDefaults.addExtraLib(content, `file:///node_modules/flowyd/${jsFilename}`);
    }
  }

  ts.typescriptDefaults.addExtraLib(ZOD_TYPES, 'file:///node_modules/zod/index.d.ts');

  // Expose `z` as a global so schema editors can write `z.object({...})` without an import.
  // Inline import() keeps the file ambient (no top-level import statement → not a module).
  ts.typescriptDefaults.addExtraLib(
    `declare const z: import('zod').z;`,
    'file:///zod-global.d.ts',
  );
}
