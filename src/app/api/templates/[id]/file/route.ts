import { apiError, apiRole, apiUser, HttpError } from "@/lib/access";
import { getTemplate } from "@/lib/data";
import { attachment, DOCX_MIME } from "@/lib/http";
import { readTemplateFile } from "@/lib/storage";

// The original uploaded .docx. The editor loads it to build blocks and the live preview.
export async function GET(request: Request, ctx: RouteContext<"/api/templates/[id]/file">) {
  try {
    const user = await apiUser();
    const { id } = await ctx.params;
    const template = getTemplate(id);
    if (!template) throw new HttpError(404, "Not found");
    apiRole(template.workspace_id, user);
    const data = await readTemplateFile(id);
    const download = new URL(request.url).searchParams.has("download");
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": DOCX_MIME,
        "Cache-Control": "private, max-age=3600",
        ...(download ? { "Content-Disposition": attachment(template.file_name.replace(/\.docx$/i, ""), "docx") } : {}),
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
