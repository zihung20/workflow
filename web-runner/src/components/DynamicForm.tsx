import { useEffect, useState } from "react";
import { describeSchema } from "../lib/zod-introspect";
import type { FieldDescriptor } from "../lib/zod-introspect";
import { useRunner } from "../context";

// ─── Default value generator ──────────────────────────────────────────────────

function autoDefault(field: FieldDescriptor): string | number | boolean {
  if (field.kind === "boolean") return true;
  if (field.kind === "enum") return field.options[0] ?? "";

  if (field.kind === "number") {
    // Use the schema minimum when present so Zod validation always passes.
    if (field.min !== undefined) return field.min;
    const n = field.name.toLowerCase();
    if (n.includes("count") || n.includes("size") || n.includes("head"))
      return 3;
    if (n.includes("platform")) return 1;
    return 1;
  }

  // string / unknown — pick a contextual default first, then pad to meet min length.
  const n = field.name.toLowerCase();
  let base = "value";
  if (/(by|lead|manager|officer|author|engineer)/.test(n)) base = "ENG-001";
  else if (
    n.includes("reason") ||
    n.includes("description") ||
    n.includes("summary") ||
    n.includes("actions")
  )
    base = "Completed as scheduled";
  else if (n.includes("url")) base = "https://example.com/doc";
  else if (n.includes("sha")) base = "a".repeat(40);
  else if (n.includes("switch") && n.includes("ref")) base = "SW-A01";
  else if (n.includes("clearance") && n.includes("ref")) base = "CLR-001";
  else if (n.endsWith("ref") || n.includes("ref")) base = "REF-001";
  else if (n.endsWith("id") || n.includes("trainid") || n.includes("ticket"))
    base = "ID-001";
  else if (n.includes("at") || n.includes("expires"))
    base = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 16);
  else if (
    n.includes("note") ||
    n.includes("finding") ||
    n.includes("cause") ||
    n.includes("fix")
  )
    base = "No issues noted";
  else if (n.includes("channel")) base = "#incident-response";
  else if (n.includes("version")) base = "1.0.0";
  else if (n.includes("team")) base = "platform-eng";

  // Pad to satisfy z.string().min(n) constraints.
  const min = field.kind === "string" ? (field.min ?? 0) : 0;
  return base.length >= min ? base : base.padEnd(min, "-");
}

function buildDefaults(fields: FieldDescriptor[]): {
  text: Record<string, string>;
  bool: Record<string, boolean>;
  num: Record<string, string>;
} {
  const text: Record<string, string> = {};
  const bool: Record<string, boolean> = {};
  const num: Record<string, string> = {};
  for (const f of fields) {
    const val = autoDefault(f);
    if (f.kind === "boolean") {
      bool[f.name] = val as boolean;
    } else if (f.kind === "number") {
      num[f.name] = String(val);
    } else {
      text[f.name] = String(val);
    }
  }
  return { text, bool, num };
}

// ─── Payload coercion ─────────────────────────────────────────────────────────

function coercePayload(
  fields: FieldDescriptor[],
  text: Record<string, string>,
  bool: Record<string, boolean>,
  num: Record<string, string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.kind === "boolean") out[f.name] = bool[f.name] ?? false;
    else if (f.kind === "number") {
      const raw = num[f.name] ?? "";
      out[f.name] = raw === "" ? undefined : Number(raw);
    } else {
      out[f.name] = text[f.name] ?? "";
    }
  }
  return out;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DynamicForm() {
  const { definition, snapshot, availableActions, dispatch, lastError } =
    useRunner();

  const [selectedAction, setSelectedAction] = useState<string>("");
  const [textValues, setTextValues] = useState<Record<string, string>>({});
  const [boolValues, setBoolValues] = useState<Record<string, boolean>>({});
  const [numValues, setNumValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  // When the available actions change (new section selected, or state advanced),
  // pick the first available action and pre-populate all fields.
  useEffect(() => {
    const next = availableActions[0] ?? "";
    setSelectedAction(next);
    if (next) {
      const schema = definition.actionSchemas.get(next);
      if (schema) {
        const fields = describeSchema(schema);
        const { text, bool, num } = buildDefaults(fields);
        setTextValues(text);
        setBoolValues(bool);
        setNumValues(num);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableActions]);

  // When the user manually picks a different action, re-populate defaults.
  function handleActionChange(action: string) {
    setSelectedAction(action);
    const schema = definition.actionSchemas.get(action);
    if (schema) {
      const fields = describeSchema(schema);
      const { text, bool, num } = buildDefaults(fields);
      setTextValues(text);
      setBoolValues(bool);
      setNumValues(num);
    }
  }

  const schema = selectedAction
    ? definition.actionSchemas.get(selectedAction)
    : undefined;
  const fields: FieldDescriptor[] = schema ? describeSchema(schema) : [];

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selectedAction) return;
    setSubmitting(true);
    try {
      const payload = coercePayload(fields, textValues, boolValues, numValues);
      await dispatch(selectedAction, payload);
    } finally {
      setSubmitting(false);
    }
  }

  if (snapshot.isTerminal) {
    return (
      <div className="p-4 text-center text-sm text-green-700 font-medium">
        Section complete — power restored ✓
      </div>
    );
  }

  if (availableActions.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-slate-400">
        No actions available
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        void handleSubmit(e);
      }}
      className="p-4 border-b border-slate-100 space-y-3 overflow-y-auto"
    >
      {/* Action selector */}
      <div>
        <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">
          Action
        </label>
        <select
          value={selectedAction}
          onChange={(e) => handleActionChange(e.target.value)}
          className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-300"
        >
          {availableActions.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </div>

      {/* SDUI field list */}
      {fields.map((field) => (
        <div key={field.name}>
          <label className="text-xs font-medium text-slate-600">
            {field.label}
            {!field.optional && <span className="text-red-400 ml-0.5">*</span>}
          </label>

          {field.kind === "boolean" && (
            <div className="mt-1 flex items-center gap-2">
              <input
                type="checkbox"
                id={`f-${field.name}`}
                checked={boolValues[field.name] ?? false}
                onChange={(e) =>
                  setBoolValues((p) => ({
                    ...p,
                    [field.name]: e.target.checked,
                  }))
                }
                className="w-4 h-4 rounded border-slate-300 text-blue-500 focus:ring-blue-300"
              />
              <label
                htmlFor={`f-${field.name}`}
                className="text-sm text-slate-700"
              >
                {field.label}
              </label>
            </div>
          )}

          {field.kind === "enum" && (
            <select
              value={textValues[field.name] ?? ""}
              onChange={(e) =>
                setTextValues((p) => ({ ...p, [field.name]: e.target.value }))
              }
              className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-300"
            >
              {field.options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          )}

          {field.kind === "number" && (
            <input
              type="number"
              value={numValues[field.name] ?? ""}
              onChange={(e) =>
                setNumValues((p) => ({ ...p, [field.name]: e.target.value }))
              }
              className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          )}

          {(field.kind === "string" || field.kind === "unknown") && (
            <input
              type="text"
              value={textValues[field.name] ?? ""}
              onChange={(e) =>
                setTextValues((p) => ({ ...p, [field.name]: e.target.value }))
              }
              placeholder={
                field.kind === "unknown" ? "JSON value" : field.label
              }
              className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          )}
        </div>
      ))}

      {/* Guard failure hint */}
      {lastError && (
        <p className="text-xs text-red-500 bg-red-50 rounded px-2 py-1">
          {lastError}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting || !selectedAction}
        className="w-full rounded bg-blue-500 hover:bg-blue-600 disabled:opacity-40 text-white text-sm font-medium py-1.5 transition-colors"
      >
        {submitting ? "Dispatching…" : `Dispatch ${selectedAction}`}
      </button>
    </form>
  );
}
