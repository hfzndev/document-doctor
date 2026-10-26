"use client";
import { useEffect, useRef, useState } from "react";
import {
  DATE_FORMATS,
  formatValue,
  renderNumber,
  type Field,
  type FieldType,
  type FieldValues,
} from "@/lib/fields";

export const TYPE_LABEL: Record<FieldType, string> = { text: "Text", date: "Date", number: "Auto number" };

const SAMPLE_DATE = { yyyy: "2026", mm: "10", dd: "26" };

/** Inputs for a field's settings. Plain named inputs, so it works inside any <form>. */
export function FieldSettings({ field, idPrefix = "f" }: { field?: Partial<Field>; idPrefix?: string }) {
  const [type, setType] = useState<FieldType>(field?.type ?? "text");
  const [pattern, setPattern] = useState(field?.number_pattern ?? "{seq:3}/INV/{roman}/{yyyy}");
  const id = (s: string) => `${idPrefix}-${s}`;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <label className="label" htmlFor={id("name")}>Name</label>
        <input id={id("name")} name="name" required maxLength={60} defaultValue={field?.name} placeholder="e.g. Document number" className="input" />
      </div>
      <div>
        <label className="label" htmlFor={id("type")}>Type</label>
        <select id={id("type")} name="type" value={type} onChange={(e) => setType(e.target.value as FieldType)} className="input">
          <option value="text">Text</option>
          <option value="date">Date</option>
          <option value="number">Auto number</option>
        </select>
      </div>
      {type === "text" && (
        <div className="sm:col-span-2">
          <label className="label" htmlFor={id("default")}>Default value <span className="font-normal text-slate-400">(optional, used for new sets)</span></label>
          <input id={id("default")} name="default_value" defaultValue={field?.default_value} className="input" />
        </div>
      )}
      {type === "date" && (
        <div className="sm:col-span-2">
          <label className="label" htmlFor={id("fmt")}>Written as</label>
          <select id={id("fmt")} name="date_format" defaultValue={field?.date_format ?? "id_long"} className="input">
            {Object.entries(DATE_FORMATS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-500">New sets start with today&apos;s date; pick another date any time.</p>
        </div>
      )}
      {type === "number" && (
        <>
          <div>
            <label className="label" htmlFor={id("pattern")}>Pattern</label>
            <input id={id("pattern")} name="number_pattern" value={pattern} onChange={(e) => setPattern(e.target.value)} maxLength={100} className="input font-mono" />
          </div>
          <div>
            <label className="label" htmlFor={id("reset")}>Counter restarts</label>
            <select id={id("reset")} name="number_reset" defaultValue={field?.number_reset ?? "yearly"} className="input">
              <option value="yearly">Every year</option>
              <option value="monthly">Every month</option>
              <option value="never">Never</option>
            </select>
          </div>
          <p className="text-xs text-slate-500 sm:col-span-2">
            <code>{"{seq:3}"}</code> → 001 · <code>{"{roman}"}</code> → month as X · <code>{"{yyyy}"}</code> <code>{"{yy}"}</code>{" "}
            <code>{"{mm}"}</code> <code>{"{dd}"}</code>. Example: <b className="font-mono">{renderNumber(pattern, 7, SAMPLE_DATE)}</b>. Each new
            set takes the next number.
          </p>
        </>
      )}
    </div>
  );
}

/** POST a FieldSettings form to the API; returns the created field or throws. */
async function createField(workspaceId: string, form: HTMLFormElement): Promise<Field> {
  const res = await fetch(`/api/workspaces/${workspaceId}/fields`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(Object.fromEntries(new FormData(form))),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Could not create field (${res.status})`);
  return json as Field;
}

/** Modal: pick an existing field or create a new one. */
export function FieldDialog({
  open,
  workspaceId,
  fields,
  title,
  hint,
  suggestedName,
  onClose,
  onPick,
}: {
  open: boolean;
  workspaceId: string;
  fields: Field[];
  title: string;
  hint?: React.ReactNode;
  suggestedName?: string;
  onClose: () => void;
  onPick: (field: Field, created: boolean) => void | Promise<void>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<"existing" | "new">(fields.length ? "existing" : "new");
  const [choice, setChoice] = useState(fields[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setError(null);
      setMode(fields.length ? "existing" : "new");
      setChoice((c) => (fields.some((f) => f.id === c) ? c : fields[0]?.id ?? ""));
      d.showModal();
    }
    if (!open && d.open) d.close();
  }, [open, fields]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "existing") {
        const f = fields.find((x) => x.id === choice);
        if (f) await onPick(f, false);
      } else {
        await onPick(await createField(workspaceId, e.currentTarget), true);
      }
      // Close right away (the "close" event then calls onClose), so focus is free for the
      // caller, e.g. to type the inserted field into the editor.
      ref.current?.close();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="m-auto w-[min(560px,calc(100vw-2rem))] rounded-xl border border-slate-200 p-0 shadow-2xl backdrop:bg-slate-900/40"
    >
      <form onSubmit={submit} className="space-y-4 p-5">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          {hint && <div className="mt-1 text-sm text-slate-500">{hint}</div>}
        </div>
        {fields.length > 0 && (
          <div className="flex gap-1 rounded-lg bg-slate-100 p-1 text-sm">
            {(["existing", "new"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`flex-1 rounded-md py-1.5 font-medium ${mode === m ? "bg-white shadow-xs" : "text-slate-500"}`}
              >
                {m === "existing" ? "Existing field" : "New field"}
              </button>
            ))}
          </div>
        )}
        {mode === "existing" ? (
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {fields.map((f) => (
              <label key={f.id} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${choice === f.id ? "border-brand-500 bg-brand-50" : "border-slate-200"}`}>
                <input type="radio" name="field" checked={choice === f.id} onChange={() => setChoice(f.id)} />
                <span className="flex-1 font-medium">{f.name}</span>
                <span className="chip">{TYPE_LABEL[f.type]}</span>
              </label>
            ))}
          </div>
        ) : (
          <FieldSettings key={suggestedName} field={{ name: suggestedName }} idPrefix="dlg" />
        )}
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || (mode === "existing" && !choice)}>
            {busy ? "Saving…" : mode === "existing" ? "Use field" : "Create field"}
          </button>
        </div>
      </form>
    </dialog>
  );
}

/** One value input, by field type. */
export function FieldValueInput({
  field,
  value,
  onChange,
  id,
}: {
  field: Field;
  value: string;
  onChange: (v: string) => void;
  id?: string;
}) {
  if (field.type === "date") {
    return (
      <div className="flex items-center gap-2">
        <input id={id} type="date" value={value} onChange={(e) => onChange(e.target.value)} className="input w-44" />
        <span className="truncate text-xs text-slate-500">{formatValue(field, value)}</span>
      </div>
    );
  }
  return (
    <input
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={field.type === "number" ? "number" : "value"}
      className={`input ${field.type === "number" ? "font-mono" : ""}`}
    />
  );
}

export type ValuesOwner = { type: "set" | "document"; id: string };

/** PATCH helper with a small debounce, shared by the editor and the set page. */
export function useFieldValues(owner: ValuesOwner, initial: FieldValues) {
  const [values, setValues] = useState<FieldValues>(initial);
  const [state, setState] = useState<"saved" | "saving" | "error">("saved");
  const pending = useRef<FieldValues>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const send = async (body: Record<string, unknown>) => {
    setState("saving");
    try {
      const res = await fetch("/api/field-values", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner, ...body }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setState("saved");
      return json.values as FieldValues;
    } catch {
      setState("error");
      return null;
    }
  };

  const flush = async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const body = pending.current;
    if (!Object.keys(body).length) return;
    pending.current = {};
    if ((await send({ values: body })) === null) pending.current = { ...body, ...pending.current };
  };

  const update = (fieldId: string, value: string) => {
    setValues((v) => ({ ...v, [fieldId]: value }));
    pending.current[fieldId] = value;
    setState("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 600);
  };

  /** Assign starting values (next number, today...) to newly used fields. */
  const ensure = async (fieldIds: string[], seed: FieldValues = {}) => {
    const all = await send({ ensure: fieldIds, seed });
    if (all) setValues((v) => ({ ...all, ...v, ...pending.current }));
  };

  return { values, update, ensure, flush, state };
}

export function FieldValuesList({
  fields,
  values,
  onChange,
}: {
  fields: Field[];
  values: FieldValues;
  onChange: (fieldId: string, value: string) => void;
}) {
  return (
    <div className="space-y-2.5">
      {fields.map((f) => (
        <div key={f.id} className="grid items-center gap-1 sm:grid-cols-[minmax(0,10rem)_1fr] sm:gap-3">
          <label htmlFor={`fv-${f.id}`} className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
            <span className="truncate">{f.name}</span>
            {f.type !== "text" && <span className="chip" aria-hidden>{TYPE_LABEL[f.type]}</span>}
          </label>
          <FieldValueInput id={`fv-${f.id}`} field={f} value={values[f.id] ?? ""} onChange={(v) => onChange(f.id, v)} />
        </div>
      ))}
    </div>
  );
}

