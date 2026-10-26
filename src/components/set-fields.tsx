"use client";
import type { Field, FieldValues } from "@/lib/fields";
import { FieldValuesList, useFieldValues } from "./fields";

export function SetFields({ setId, fields, values }: { setId: string; fields: Field[]; values: FieldValues }) {
  const fv = useFieldValues({ type: "set", id: setId }, values);
  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="font-semibold">Shared values</h2>
        <span className={`text-xs ${fv.state === "error" ? "text-red-600" : "text-slate-400"}`}>
          {fv.state === "saving" ? "Saving…" : fv.state === "error" ? "Not saved" : "Saved"}
        </span>
      </div>
      {fields.length ? (
        <FieldValuesList fields={fields} values={fv.values} onChange={fv.update} />
      ) : (
        <p className="text-sm text-slate-500">
          None of this set&apos;s documents use shared fields yet. Mark them on a template, or insert one in a document.
        </p>
      )}
    </div>
  );
}
