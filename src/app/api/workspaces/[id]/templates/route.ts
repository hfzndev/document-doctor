import { randomUUID } from "node:crypto";
import { apiError, apiRole, apiUser, assertSameOrigin, HttpError } from "@/lib/access";
import { config } from "@/lib/config";
import { createTemplate } from "@/lib/data";
import { extractBlocks, TemplateError } from "@/lib/docx/template";
import { saveTemplateFile } from "@/lib/storage";

// Upload a .docx as a new template. Any workspace member can add templates.
export async function POST(request: Request, ctx: RouteContext<"/api/workspaces/[id]/templates">) {
  try {
    assertSameOrigin(request);
    const user = await apiUser();
    const { id: workspaceId } = await ctx.params;
    apiRole(workspaceId, user);

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new HttpError(400, "Choose a .docx file to upload.");
    if (file.size > config.maxUploadBytes) {
      throw new HttpError(413, `File is larger than ${config.maxUploadBytes / 1024 / 1024} MB.`);
    }
    if (!/\.docx$/i.test(file.name)) throw new HttpError(400, "Only Word .docx files are supported.");

    const data = new Uint8Array(await file.arrayBuffer());
    let blocks;
    try {
      blocks = await extractBlocks(data);
    } catch (e) {
      if (e instanceof TemplateError) throw new HttpError(400, e.message);
      throw e;
    }
    const editable = blocks.filter((b) => !b.empty && !b.locked).length;
    if (editable === 0) throw new HttpError(400, "This document has no text to edit.");

    const id = randomUUID();
    const name = String(form.get("name") ?? "").trim() || file.name.replace(/\.docx$/i, "");
    await saveTemplateFile(id, data);
    createTemplate({
      id,
      workspace_id: workspaceId,
      name: name.slice(0, 200),
      description: String(form.get("description") ?? "").trim().slice(0, 1000),
      file_name: file.name.slice(0, 255),
      file_size: file.size,
      block_count: editable,
      created_by: user.id,
    });
    return Response.json({ id }, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
