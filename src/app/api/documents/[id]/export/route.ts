import { apiError, apiRole, apiUser, HttpError } from "@/lib/access";
import { getDocument } from "@/lib/data";
import { applyEdits } from "@/lib/docx/template";
import { attachment, DOCX_MIME } from "@/lib/http";
import { docxToPdf } from "@/lib/pdf";
import { readTemplateFile } from "@/lib/storage";

// Download the filled-in document as .docx or .pdf (?format=docx|pdf).
export async function GET(request: Request, ctx: RouteContext<"/api/documents/[id]/export">) {
  try {
    const user = await apiUser();
    const { id } = await ctx.params;
    const doc = getDocument(id);
    if (!doc) throw new HttpError(404, "Not found");
    apiRole(doc.workspace_id, user);

    const format = new URL(request.url).searchParams.get("format") ?? "docx";
    if (format !== "docx" && format !== "pdf") throw new HttpError(400, "format must be docx or pdf");

    const docx = await applyEdits(await readTemplateFile(doc.template_id), JSON.parse(doc.values_json));
    if (format === "docx") {
      return new Response(docx as Uint8Array<ArrayBuffer>, {
        headers: { "Content-Type": DOCX_MIME, "Content-Disposition": attachment(doc.title, "docx") },
      });
    }
    const pdf = await docxToPdf(docx);
    const inline = new URL(request.url).searchParams.has("inline");
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": inline ? "inline" : attachment(doc.title, "pdf"),
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
