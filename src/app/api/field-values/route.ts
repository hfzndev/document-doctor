import { apiError, apiRole, apiUser, assertSameOrigin, HttpError } from "@/lib/access";
import { getDocument } from "@/lib/data";
import { ensureValues, getSet, listFields, setValues, touchSet, valueOwner } from "@/lib/data-fields";
import type { FieldValues } from "@/lib/fields";

type Body = {
  owner?: { type?: string; id?: string };
  /** field id -> new raw value */
  values?: Record<string, unknown>;
  /** give these fields their starting value if they have none (e.g. a field just inserted) */
  ensure?: unknown[];
  /** starting values to use for `ensure` (e.g. the text that was selected) */
  seed?: Record<string, unknown>;
};

// Read/write shared field values of a set, or of a standalone document.
export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await apiUser();
    const body = (await request.json().catch(() => ({}))) as Body;

    let ownerId: string;
    let workspaceId: string;
    let setId: string | null = null;
    if (body.owner?.type === "set") {
      const set = getSet(String(body.owner.id));
      if (!set) throw new HttpError(404, "Not found");
      ownerId = set.id;
      workspaceId = set.workspace_id;
      setId = set.id;
    } else {
      const doc = getDocument(String(body.owner?.id));
      if (!doc) throw new HttpError(404, "Not found");
      ownerId = valueOwner(doc);
      workspaceId = doc.workspace_id;
      setId = doc.set_id;
    }
    apiRole(workspaceId, user);

    const fields = new Map(listFields(workspaceId).map((f) => [f.id, f]));
    const clean = (obj: Record<string, unknown> | undefined): FieldValues => {
      const out: FieldValues = {};
      for (const [k, v] of Object.entries(obj ?? {})) {
        if (!fields.has(k) || typeof v !== "string" || v.length > 5000) throw new HttpError(400, `invalid value for ${k}`);
        out[k] = v;
      }
      return out;
    };
    const values = clean(body.values);
    if (Object.keys(values).length) setValues(ownerId, values);
    const ensure = (body.ensure ?? []).map(String).filter((id) => fields.has(id)).map((id) => fields.get(id)!);
    const all = ensureValues(ownerId, ensure, clean(body.seed));
    if (setId) touchSet(setId);
    return Response.json({ values: all });
  } catch (e) {
    return apiError(e);
  }
}
