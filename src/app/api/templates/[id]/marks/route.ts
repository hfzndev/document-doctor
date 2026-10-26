import { apiError, apiRole, apiUser, assertSameOrigin, HttpError } from "@/lib/access";
import { getTemplate } from "@/lib/data";
import { addMark, deleteMark, getField, listMarks } from "@/lib/data-fields";
import { markProblem } from "@/lib/fields";
import { templateBlocks } from "@/lib/render";

async function template(request: Request, id: string) {
  assertSameOrigin(request);
  const user = await apiUser();
  const t = getTemplate(id);
  if (!t) throw new HttpError(404, "Not found");
  apiRole(t.workspace_id, user);
  return t;
}

// Mark a character range of a template paragraph as a shared field.
export async function POST(request: Request, ctx: RouteContext<"/api/templates/[id]/marks">) {
  try {
    const { id } = await ctx.params;
    const t = await template(request, id);
    const body = await request.json().catch(() => ({}));
    const { blockId, fieldId } = body as { blockId?: string; fieldId?: string };
    const start = Number(body.start);
    const end = Number(body.end);
    const field = getField(String(fieldId));
    if (!field || field.workspace_id !== t.workspace_id) throw new HttpError(400, "Unknown field");
    const block = (await templateBlocks(id)).find((b) => b.id === blockId);
    if (!block) throw new HttpError(400, "Unknown paragraph");
    const problem = markProblem(block, start, end, listMarks(id));
    if (problem) throw new HttpError(400, problem);
    return Response.json(addMark(id, { block_id: block.id, start, end, field_id: field.id }), { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(request: Request, ctx: RouteContext<"/api/templates/[id]/marks">) {
  try {
    const { id } = await ctx.params;
    await template(request, id);
    deleteMark(id, new URL(request.url).searchParams.get("mark") ?? "");
    return new Response(null, { status: 204 });
  } catch (e) {
    return apiError(e);
  }
}
