import type { Metadata } from "next";
import { deleteDocument, duplicateDocument } from "@/app/actions";
import { requireDocument, requireUser } from "@/lib/access";
import { getDocument } from "@/lib/data";
import { Editor } from "@/components/editor";
import { ConfirmButton } from "@/components/ui";

export async function generateMetadata({ params }: PageProps<"/d/[id]">): Promise<Metadata> {
  const doc = getDocument((await params).id);
  return { title: doc?.title ?? "Document" };
}

export default async function DocumentPage({ params }: PageProps<"/d/[id]">) {
  const { id } = await params;
  const user = await requireUser(`/d/${id}`);
  const { document, workspace, role } = requireDocument(id, user);
  const canDelete = document.created_by === user.id || role !== "member";

  const menu = (
    <details className="relative">
      <summary className="btn btn-ghost list-none" aria-label="More actions">⋯</summary>
      <div className="absolute right-0 z-30 mt-1 w-48 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
        <form action={duplicateDocument.bind(null, id)}>
          <button className="w-full rounded px-3 py-2 text-left text-sm hover:bg-slate-100">Duplicate</button>
        </form>
        <a
          href={`/api/documents/${id}/export?format=pdf&inline=1`}
          target="_blank"
          className="block rounded px-3 py-2 text-sm hover:bg-slate-100"
        >
          Open PDF in new tab
        </a>
        {canDelete && (
          <form action={deleteDocument.bind(null, id)}>
            <ConfirmButton
              message="Delete this document? The template is not affected."
              className="w-full rounded px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50"
            >
              Delete document
            </ConfirmButton>
          </form>
        )}
      </div>
    </details>
  );

  return (
    <Editor
      documentId={id}
      workspaceId={workspace.id}
      workspaceName={workspace.name}
      templateId={document.template_id}
      templateName={document.template_name ?? "Template"}
      initialTitle={document.title}
      initialValues={JSON.parse(document.values_json)}
      menu={menu}
    />
  );
}
