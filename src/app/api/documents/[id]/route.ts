import { apiError, apiRole, apiUser, assertSameOrigin, HttpError } from "@/lib/access";
import { getDocument, updateDocument } from "@/lib/data";

const BLOCK_ID = /^word\/[\w.-]+\.xml#\d{1,6}$/;
const MAX_BODY = 4 * 1024 * 1024;

// Autosave from the editor: { title?, values? } where values maps block id -> text.
export async function PATCH(request: Request, ctx: RouteContext<"/api/documents/[id]">) {
  try {
    assertSameOrigin(request);
    const user = await apiUser();
    const { id } = await ctx.params;
    const doc = getDocument(id);
    if (!doc) throw new HttpError(404, "Not found");
    apiRole(doc.workspace_id, user);

    const raw = await request.text();
    if (raw.length > MAX_BODY) throw new HttpError(413, "Document is too large.");
    let body: { title?: unknown; values?: unknown };
    try {
      body = JSON.parse(raw);
    } catch {
      throw new HttpError(400, "Invalid JSON");
    }

    const fields: { title?: string; values?: Record<string, string> } = {};
    if (body.title !== undefined) {
      if (typeof body.title !== "string") throw new HttpError(400, "title must be a string");
      fields.title = body.title.trim().slice(0, 200) || "Untitled document";
    }
    if (body.values !== undefined) {
      if (!body.values || typeof body.values !== "object" || Array.isArray(body.values)) {
        throw new HttpError(400, "values must be an object");
      }
      fields.values = {};
      for (const [k, v] of Object.entries(body.values)) {
        if (!BLOCK_ID.test(k) || typeof v !== "string") throw new HttpError(400, `invalid value for ${k}`);
        fields.values[k] = v;
      }
    }
    const updatedAt = updateDocument(id, fields, user.id);
    return Response.json({ updatedAt });
  } catch (e) {
    return apiError(e);
  }
}
