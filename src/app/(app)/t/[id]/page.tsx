import type { Metadata } from "next";
import Link from "next/link";
import { createDocument, deleteTemplate, updateTemplate } from "@/app/actions";
import { requireTemplate, requireUser } from "@/lib/access";
import { getTemplate, listDocuments } from "@/lib/data";
import { fileSize, timeAgo } from "@/lib/format";
import { TemplatePreview } from "@/components/template-preview";
import { ConfirmButton, SubmitButton } from "@/components/ui";

export async function generateMetadata({ params }: PageProps<"/t/[id]">): Promise<Metadata> {
  return { title: getTemplate((await params).id)?.name ?? "Template" };
}

export default async function TemplatePage({ params }: PageProps<"/t/[id]">) {
  const { id } = await params;
  const user = await requireUser(`/t/${id}`);
  const { template, workspace, role } = requireTemplate(id, user);
  const documents = listDocuments(workspace.id, id);
  const canDelete = template.created_by === user.id || role !== "member";

  return (
    <div className="flex flex-1 flex-col lg:h-[calc(100dvh-3.5rem)] lg:flex-row">
      <aside className="w-full shrink-0 overflow-y-auto border-slate-200 bg-white p-6 lg:w-[420px] lg:border-r">
        <nav className="text-sm text-slate-500">
          <Link href="/" className="hover:text-slate-800">Workspaces</Link> /{" "}
          <Link href={`/w/${workspace.id}`} className="hover:text-slate-800">{workspace.name}</Link> /
        </nav>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{template.name}</h1>
        <p className="mt-1 text-xs text-slate-500">
          {template.file_name} · {fileSize(template.file_size)} · {template.block_count} editable blocks · uploaded by{" "}
          {template.creator_name} {timeAgo(template.created_at)}
        </p>
        {template.description && <p className="mt-3 text-sm text-slate-700">{template.description}</p>}

        <form action={createDocument.bind(null, id)} className="mt-6 space-y-2 rounded-xl bg-brand-50 p-4">
          <label className="label" htmlFor="doc-title">New document from this template</label>
          <input id="doc-title" name="title" placeholder={`${template.name} – ${new Date().toISOString().slice(0, 10)}`} className="input" maxLength={200} />
          <SubmitButton className="btn btn-primary w-full">Start editing</SubmitButton>
        </form>

        <section className="mt-8">
          <h2 className="text-sm font-semibold">Documents from this template</h2>
          {documents.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">None yet.</p>
          ) : (
            <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
              {documents.map((d) => (
                <li key={d.id}>
                  <Link href={`/d/${d.id}`} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50">
                    <span className="flex-1 truncate">{d.title}</span>
                    <span className="text-xs text-slate-500">{timeAgo(d.updated_at)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <details className="mt-8 rounded-lg border border-slate-200 p-4">
          <summary className="cursor-pointer text-sm font-semibold">Template settings</summary>
          <form action={updateTemplate.bind(null, id)} className="mt-4 space-y-3">
            <div>
              <label className="label" htmlFor="tpl-name">Name</label>
              <input id="tpl-name" name="name" defaultValue={template.name} required maxLength={200} className="input" />
            </div>
            <div>
              <label className="label" htmlFor="tpl-desc">Description</label>
              <textarea id="tpl-desc" name="description" defaultValue={template.description} rows={3} maxLength={1000} className="input" />
            </div>
            <SubmitButton className="btn">Save</SubmitButton>
          </form>
          <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
            <a href={`/api/templates/${id}/file?download=1`} className="btn">Download original</a>
            {canDelete && (
              <form action={deleteTemplate.bind(null, id)}>
                <ConfirmButton message={`Delete "${template.name}" and all ${documents.length} document(s) made from it?`}>
                  Delete template
                </ConfirmButton>
              </form>
            )}
          </div>
        </details>
      </aside>
      <TemplatePreview templateId={id} />
    </div>
  );
}
