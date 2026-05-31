import { ZodFirstPartyTypeKind } from 'zod';
import type { ZodTypeAny } from 'zod';

export type FieldDescriptor =
  | { kind: 'string';  name: string; label: string; optional: boolean; min?: number }
  | { kind: 'number';  name: string; label: string; optional: boolean; min?: number; max?: number }
  | { kind: 'boolean'; name: string; label: string; optional: boolean }
  | { kind: 'enum';    name: string; label: string; optional: boolean; options: string[] }
  | { kind: 'unknown'; name: string; label: string; optional: boolean };

/**
 * Walks a Zod schema and returns a flat list of field descriptors that
 * `DynamicForm` renders into HTML inputs.
 *
 * Supports: ZodObject, ZodString, ZodNumber, ZodBoolean, ZodEnum,
 *           ZodLiteral (bool → checkbox), ZodOptional, ZodDefault.
 * Everything else falls back to a free-text input.
 */
export function describeSchema(schema: ZodTypeAny): FieldDescriptor[] {
  return walk(schema, '', false);
}

function toLabel(key: string): string {
  return key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').trim();
}

function walk(schema: ZodTypeAny, key: string, optional: boolean): FieldDescriptor[] {
  const typeName = schema._def.typeName as ZodFirstPartyTypeKind;
  const label = toLabel(key);

  switch (typeName) {
    case ZodFirstPartyTypeKind.ZodObject: {
      // shape is a getter that returns the field map
      const shape = (schema._def as { shape: () => Record<string, ZodTypeAny> }).shape();
      return Object.entries(shape).flatMap(([k, v]) => walk(v, k, false));
    }

    case ZodFirstPartyTypeKind.ZodOptional:
      return walk(
        (schema._def as { innerType: ZodTypeAny }).innerType,
        key,
        true,
      );

    case ZodFirstPartyTypeKind.ZodDefault:
      return walk(
        (schema._def as { innerType: ZodTypeAny }).innerType,
        key,
        optional,
      );

    case ZodFirstPartyTypeKind.ZodString: {
      if (!key) return [];
      const checks = (schema._def as { checks: { kind: string; value?: number }[] }).checks;
      const min = checks.find(c => c.kind === 'min')?.value;
      return [{ kind: 'string', name: key, label, optional, ...(min !== undefined && { min }) }];
    }

    case ZodFirstPartyTypeKind.ZodNumber: {
      if (!key) return [];
      const checks = (schema._def as { checks: { kind: string; value?: number }[] }).checks;
      const min = checks.find(c => c.kind === 'min')?.value;
      const max = checks.find(c => c.kind === 'max')?.value;
      return [{ kind: 'number', name: key, label, optional,
        ...(min !== undefined && { min }), ...(max !== undefined && { max }) }];
    }

    case ZodFirstPartyTypeKind.ZodBoolean:
      return key ? [{ kind: 'boolean', name: key, label, optional }] : [];

    case ZodFirstPartyTypeKind.ZodLiteral: {
      const val = (schema._def as { value: unknown }).value;
      if (key && typeof val === 'boolean') {
        // z.literal(true) → render as a required checkbox
        return [{ kind: 'boolean', name: key, label, optional: false }];
      }
      // Other literals (string/number constants) are not user-editable
      return [];
    }

    case ZodFirstPartyTypeKind.ZodEnum: {
      const values = (schema._def as { values: string[] }).values;
      return key ? [{ kind: 'enum', name: key, label, optional, options: values }] : [];
    }

    default:
      return key ? [{ kind: 'unknown', name: key, label, optional }] : [];
  }
}
