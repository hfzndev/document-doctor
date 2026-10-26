import { apiError, apiRole, apiUser, assertSameOrigin, HttpError } from "@/lib/access";
import { createField, parseFieldInput } from "@/lib/data-fields";

// Create a shared field (from the editor or the template field marker). Any member can.
export async function POST(request: Request, ctx: RouteContext<"/api/workspaces/[id]/fields">) {
  try {
    assertSameOrigin(request);
    const user = await apiUser();
    const { id } = await ctx.params;
    apiRole(id, user);
    const input = parseFieldInput(await request.json().catch(() => ({})));
    if (typeof input === "string") throw new HttpError(400, input);
    const field = createField(id, input, user.id);
    if (typeof field === "string") throw new HttpError(409, field);
    return Response.json(field, { status: 201 });
  } catch (e) {
    return apiError(e);
  }
}
