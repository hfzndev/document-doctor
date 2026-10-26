import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { addDocumentToSet, deleteSetAction, renameSetAction } from "@/app/actions";
import { requireUser, requireWorkspace } from "@/lib/access";
import { listDocuments, listTemplates } from "@/lib/data";
import { getSet, listFields } from "@/lib/data-fields";
import { timeAgo } from "@/lib/format";
import { setContext } from "@/lib/render";
import { SetFields } from "@/components/set-fields";
import { ConfirmButton, SubmitButton } from "@/components/ui";

export async function generateMetadata({ params }: PageProps<"/s/[id]">): Promise<Metadata> {
  return { title: getSet((await params).id)?.name ?? "Set" };
}

export default async function SetPage({ params }: PageProps<"/s/[id]">) {
  const { id } = await params;
  const user = await requireUser(`/s/${id}`);
  const set = getSet(id);
  if (!set) notFound();
  const { workspace, role } = requireWorkspace(set.workspace_id, user);
  const docs = listDocuments(workspace.id, { setId: id });
  const templates = listTemplates(workspace.id);
  const { used, values } = await setContext(id, docs, listFields(workspace.id));
  const canDelete = set.created_by === user.id || role !== "member";

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8">
      <nav className="text-sm text-slate-500">
        <Link href="/" className="hover:text-slate-800">Workspaces</Link> /{" "}
        <Link href={`/w/${workspace.id}`} className="hover:text-slate-800">{workspace.name}</Link> / Sets /
      </nav>
      <form action={renameSetAction.bind(null, id)} className="mt-1 flex items-center gap-2">
        <input
          name="name"
          defaultValue={set.name}
          required
          maxLength={200}
          aria-label="Set name"
          className="-ml-1 min-w-0 flex-1 rounded px-1 text-2xl font-semibold tracking-tight hover:bg-slate-100 focus:bg-white focus:ring-2 focus:ring-brand-100 focus:outline-none"
        />
        <SubmitButton className="btn btn-ghost">Rename</SubmitButton>
      </form>
      <p className="mt-1 text-sm text-slate-500">
        A set is a group of documents that share values like a document number and date. Change a value here, and every
        document below changes with it.
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1.1fr]">
        <section className="card p-5">
          <SetFields setId={id} fields={used} values={values} />
        </section>

        <section className="space-y-4">
          <div className="card overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-3">
              <h2 className="flex-1 font-semibold">Documents ({docs.length})</h2>
              {docs.length > 0 && (
                <>
                  <a href={`/api/sets/${id}/export?format=docx`} className="btn">All as DOCX (.zip)</a>
                  <a href={`/api/sets/${id}/export?format=pdf`} className="btn btn-primary">All as PDF (.zip)</a>
                </>
              )}
            </div>
            {docs.length === 0 ? (
              <p className="px-5 py-6 text-center text-sm text-slate-500">No documents yet. Add one below.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {docs.map((d) => (
                  <li key={d.id}>
                    <Link href={`/d/${d.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 hover:bg-slate-50">
                      <span className="min-w-0 flex-1 truncate font-medium">{d.title}</span>
                      <span className="chip">{d.template_name}</span>
                      <span className="text-xs text-slate-500">{timeAgo(d.updated_at)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {templates.length > 0 && (
            <form action={addDocumentToSet.bind(null, id)} className="card flex flex-wrap items-end gap-2 p-5">
              <div className="min-w-48 flex-1">
                <label className="label" htmlFor="add-tpl">Add a document from template</label>
                <select id="add-tpl" name="template" className="input">
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
              <SubmitButton className="btn">Add document</SubmitButton>
            </form>
          )}

          {canDelete && (
            <form action={deleteSetAction.bind(null, id)} className="text-right">
              <ConfirmButton message={`Delete “${set.name}” and its ${docs.length} document(s)? Templates are not affected.`} className="btn btn-ghost text-red-700">
                Delete set
              </ConfirmButton>
            </form>
          )}
        </section>
      </div>
    </main>
  );
}
