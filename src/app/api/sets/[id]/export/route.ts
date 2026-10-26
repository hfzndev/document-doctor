import JSZip from "jszip";
import { apiError, apiRole, apiUser, HttpError } from "@/lib/access";
import { listDocuments } from "@/lib/data";
import { getSet } from "@/lib/data-fields";
import { attachment } from "@/lib/http";
import { docxToPdf } from "@/lib/pdf";
import { buildDocx } from "@/lib/render";

// Every document of a set in one .zip (?format=docx|pdf).
export async function GET(request: Request, ctx: RouteContext<"/api/sets/[id]/export">) {
  try {
    const user = await apiUser();
    const { id } = await ctx.params;
    const set = getSet(id);
    if (!set) throw new HttpError(404, "Not found");
    apiRole(set.workspace_id, user);
    const format = new URL(request.url).searchParams.get("format") ?? "docx";
    if (format !== "docx" && format !== "pdf") throw new HttpError(400, "format must be docx or pdf");

    const docs = listDocuments(set.workspace_id, { setId: id });
    if (!docs.length) throw new HttpError(400, "This set has no documents.");
    const zip = new JSZip();
    const used = new Set<string>();
    for (const doc of docs.reverse()) {
      const docx = await buildDocx(doc);
      const data = format === "pdf" ? await docxToPdf(docx) : docx;
      const base = doc.title.replace(/[\\/:*?"<>|\x00-\x1f]+/g, " ").trim().slice(0, 120) || "document";
      let name = `${base}.${format}`;
      for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base} (${i}).${format}`;
      used.add(name.toLowerCase());
      zip.file(name, data);
    }
    const out = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    return new Response(out as Uint8Array<ArrayBuffer>, {
      headers: { "Content-Type": "application/zip", "Content-Disposition": attachment(`${set.name} (${format.toUpperCase()})`, "zip") },
    });
  } catch (e) {
    return apiError(e);
  }
}
