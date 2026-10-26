// Server-side document assembly: template file + block edits + shared field values.
import "server-only";
import type { DocumentRow } from "./data";
import { ensureValues, listFields, listMarks, valueOwner } from "./data-fields";
import { applyEdits, extractBlocks, type Block, type Values } from "./docx/template";
import { computeEdits, referencedFields, type Field, type FieldValues, type Mark } from "./fields";
import { readTemplateFile } from "./storage";

// Template files never change after upload, so their blocks can be cached per process.
const blockCache = new Map<string, Promise<Block[]>>();

export function templateBlocks(templateId: string): Promise<Block[]> {
  let hit = blockCache.get(templateId);
  if (!hit) {
    hit = readTemplateFile(templateId).then((data) => extractBlocks(data));
    hit.catch(() => blockCache.delete(templateId));
    if (blockCache.size > 200) blockCache.delete(blockCache.keys().next().value!);
    blockCache.set(templateId, hit);
  }
  return hit;
}

export type DocumentContext = {
  blocks: Block[];
  docValues: Values;
  marks: Mark[];
  fields: Field[];
  used: Field[];
  values: FieldValues;
};

/** Everything a document needs, with starting values assigned to fields it uses. */
export async function documentContext(doc: DocumentRow): Promise<DocumentContext> {
  const blocks = await templateBlocks(doc.template_id);
  const docValues = JSON.parse(doc.values_json) as Values;
  const marks = listMarks(doc.template_id);
  const fields = listFields(doc.workspace_id);
  const { used } = referencedFields(blocks, docValues, marks, fields);
  const values = ensureValues(valueOwner(doc), used);
  return { blocks, docValues, marks, fields, used, values };
}

export async function buildDocx(doc: DocumentRow): Promise<Uint8Array> {
  const ctx = await documentContext(doc);
  const edits = computeEdits(ctx.blocks, ctx.docValues, ctx.marks, ctx.fields, ctx.values);
  return applyEdits(await readTemplateFile(doc.template_id), edits);
}

/** Fields used by any document of a set (values assigned). */
export async function setContext(setId: string, docs: DocumentRow[], fields: Field[]) {
  const ids = new Set<string>();
  for (const doc of docs) {
    const blocks = await templateBlocks(doc.template_id);
    const { used } = referencedFields(blocks, JSON.parse(doc.values_json), listMarks(doc.template_id), fields);
    used.forEach((f) => ids.add(f.id));
  }
  const used = fields.filter((f) => ids.has(f.id));
  return { used, values: ensureValues(setId, used) };
}
