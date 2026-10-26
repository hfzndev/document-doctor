import type { Metadata } from "next";
import Link from "next/link";
import { createFieldAction, deleteFieldAction, updateFieldAction } from "@/app/actions";
import { atLeast, requireUser, requireWorkspace } from "@/lib/access";
import { fieldUsage, listFields, previewNextNumber } from "@/lib/data-fields";
import { DATE_FORMATS } from "@/lib/fields";
import { FieldSettings, TYPE_LABEL } from "@/components/fields";
import { ConfirmButton, SubmitButton } from "@/components/ui";

export const metadata: Metadata = { title: "Shared fields" };

export default async function FieldsPage({ params, searchParams }: PageProps<"/w/[id]/fields">) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await requireUser(`/w/${id}/fields`);
  const { workspace, role } = requireWorkspace(id, user);
  const fields = listFields(id);
  const usage = fieldUsage(id);
  const error = typeof sp.error === "string" ? sp.error : null;

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8">
      <nav className="text-sm text-slate-500">
        <Link href="/" className="hover:text-slate-800">Workspaces</Link> /{" "}
        <Link href={`/w/${id}`} className="hover:text-slate-800">{workspace.name}</Link> /
      </nav>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Shared fields</h1>
      <p className="mt-1 text-sm text-slate-500">
        Values typed once per set, such as a document number, date or client name, and repeated in every document of
        the set. Mark them on a template (template page → <i>Shared fields</i>), or type{" "}
        <code className="rounded bg-slate-100 px-1">{"{{Field name}}"}</code> in any document.
      </p>
      {error && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="mt-6 space-y-3">
        {fields.map((f) => {
          const canEdit = atLeast(role, "admin") || f.created_by === user.id;
          const summary =
            f.type === "date"
              ? `Written as ${DATE_FORMATS[f.date_format]}`
              : f.type === "number"
                ? `Next: ${previewNextNumber(f)} · restarts ${f.number_reset === "never" ? "never" : f.number_reset === "yearly" ? "every year" : "every month"}`
                : f.default_value
                  ? `Default: ${f.default_value}`
                  : "Free text";
          return (
            <details key={f.id} className="card group">
              <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 px-5 py-3">
                <span className="font-medium">{f.name}</span>
                <span className="chip">{TYPE_LABEL[f.type]}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-slate-500">{summary}</span>
                <span className="text-xs text-slate-400">
                  {usage.get(f.id) ?? 0} template mark{usage.get(f.id) === 1 ? "" : "s"}
                </span>
              </summary>
              {canEdit && (
                <div className="border-t border-slate-100 px-5 py-4">
                  <form action={updateFieldAction.bind(null, f.id)} className="space-y-3">
                    <FieldSettings field={f} idPrefix={f.id} />
                    <p className="text-xs text-slate-500">Renaming also updates {"{{tokens}}"} in existing documents.</p>
                    <div className="flex gap-2">
                      <SubmitButton className="btn btn-primary">Save</SubmitButton>
                    </div>
                  </form>
                  <form action={deleteFieldAction.bind(null, f.id)} className="mt-3 border-t border-slate-100 pt-3">
                    <ConfirmButton message={`Delete “${f.name}”? Template marks using it are removed and its values are lost.`}>
                      Delete field
                    </ConfirmButton>
                  </form>
                </div>
              )}
            </details>
          );
        })}
        {fields.length === 0 && (
          <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">No fields yet.</p>
        )}
      </div>

      <form action={createFieldAction.bind(null, id)} className="card mt-6 space-y-3 p-5">
        <h2 className="font-semibold">New field</h2>
        <FieldSettings idPrefix="new" />
        <SubmitButton>Create field</SubmitButton>
      </form>
    </main>
  );
}
