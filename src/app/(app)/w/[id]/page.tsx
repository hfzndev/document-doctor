import Link from "next/link";
import { requireUser, requireWorkspace } from "@/lib/access";
import { listDocuments, listTemplates } from "@/lib/data";
import { timeAgo } from "@/lib/format";
import { UploadTemplate } from "@/components/upload-template";
import { createDocument } from "@/app/actions";
import { SubmitButton } from "@/components/ui";

export default async function WorkspacePage({ params }: PageProps<"/w/[id]">) {
  const { id } = await params;
  const user = await requireUser(`/w/${id}`);
  const { workspace, role } = requireWorkspace(id, user);
  const templates = listTemplates(id);
  const documents = listDocuments(id);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      <nav className="text-sm text-slate-500">
        <Link href="/" className="hover:text-slate-800">Workspaces</Link> /
      </nav>
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <h1 className="flex-1 text-2xl font-semibold tracking-tight">{workspace.name}</h1>
        <Link href={`/w/${id}/members`} className="btn">
          {role === "member" ? "Members" : "Members & settings"}
        </Link>
      </div>

      <section className="mt-8">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Templates</h2>
            <p className="text-sm text-slate-500">
              Upload a Word document. Its headers, headings, paragraphs and footers become editable fields.
            </p>
          </div>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((t) => (
            <div key={t.id} className="card flex flex-col p-5">
              <Link href={`/t/${t.id}`} className="font-semibold hover:text-brand-700">{t.name}</Link>
              {t.description && <p className="mt-1 line-clamp-2 text-sm text-slate-600">{t.description}</p>}
              <p className="mt-2 text-xs text-slate-500">
                {t.block_count} editable blocks · by {t.creator_name} · {timeAgo(t.created_at)}
              </p>
              <div className="mt-4 flex gap-2">
                <form action={createDocument.bind(null, t.id)}>
                  <SubmitButton>Use template</SubmitButton>
                </form>
                <Link href={`/t/${t.id}`} className="btn">Preview</Link>
              </div>
            </div>
          ))}
          <UploadTemplate workspaceId={id} />
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Documents</h2>
        {documents.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
            No documents yet. Pick a template and click <b>Use template</b>.
          </p>
        ) : (
          <div className="card mt-3 divide-y divide-slate-100 overflow-hidden">
            {documents.map((d) => (
              <Link key={d.id} href={`/d/${d.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-slate-50">
                <span className="min-w-0 flex-1 truncate font-medium">{d.title}</span>
                <span className="chip">{d.template_name}</span>
                <span className="w-44 text-right text-xs text-slate-500">
                  {d.updater_name} · {timeAgo(d.updated_at)}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
