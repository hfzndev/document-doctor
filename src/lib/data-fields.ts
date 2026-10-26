// SQL for shared fields, template marks, document sets and field values.
// Callers are responsible for authorization (see access.ts).
import "server-only";
import { randomUUID } from "node:crypto";
import { config } from "./config";
import type { DocumentRow } from "./data";
import { db, now } from "./db";
import {
  counterPeriod,
  FIELD_NAME_RE,
  FIELD_TOKEN_RE,
  normName,
  renderNumber,
  today,
  type DateFormat,
  type Field,
  type FieldType,
  type FieldValues,
  type Mark,
  type NumberReset,
} from "./fields";

export type FieldRow = Field & { workspace_id: string; created_by: string; created_at: number };
export type FieldInput = Omit<Field, "id">;
export type SetRow = {
  id: string;
  workspace_id: string;
  name: string;
  created_by: string;
  created_at: number;
  updated_at: number;
  documents?: number;
};

const FIELD_COLS =
  "id, workspace_id, name, type, date_format, number_pattern, number_reset, default_value, created_by, created_at";

// ----------------------------------------------------------------- fields
/** Validate user input for a field. Returns the clean input or an error message. */
export function parseFieldInput(raw: Record<string, unknown>): FieldInput | string {
  const name = String(raw.name ?? "").trim().replace(/\s+/g, " ");
  if (!FIELD_NAME_RE.test(name)) return "Field names are 1–60 characters, without { } [ ] or line breaks.";
  const type = String(raw.type ?? "text") as FieldType;
  if (!["text", "date", "number"].includes(type)) return "Unknown field type.";
  const date_format = String(raw.date_format || "id_long") as DateFormat;
  if (!["id_long", "dmy", "iso"].includes(date_format)) return "Unknown date format.";
  const number_reset = String(raw.number_reset || "yearly") as NumberReset;
  if (!["yearly", "monthly", "never"].includes(number_reset)) return "Unknown counter reset.";
  const number_pattern = String(raw.number_pattern ?? "").trim().slice(0, 100) || "{seq:3}";
  if (type === "number" && !/\{seq(:\d{1,2})?\}/.test(number_pattern)) {
    return "A number pattern needs {seq} (or {seq:3} for 001, 002…).";
  }
  const default_value = String(raw.default_value ?? "").slice(0, 2000);
  return { name, type, date_format, number_pattern, number_reset, default_value };
}

export function listFields(workspaceId: string): FieldRow[] {
  return db()
    .prepare(`SELECT ${FIELD_COLS} FROM fields WHERE workspace_id = ? ORDER BY name COLLATE NOCASE`)
    .all(workspaceId) as FieldRow[];
}

export function getField(id: string): FieldRow | null {
  return (db().prepare(`SELECT ${FIELD_COLS} FROM fields WHERE id = ?`).get(id) as FieldRow | undefined) ?? null;
}

function nameTaken(workspaceId: string, name: string, exceptId = ""): boolean {
  return !!db()
    .prepare("SELECT 1 FROM fields WHERE workspace_id = ? AND name = ? COLLATE NOCASE AND id != ?")
    .get(workspaceId, name, exceptId);
}

export function createField(workspaceId: string, input: FieldInput, userId: string): FieldRow | string {
  if (nameTaken(workspaceId, input.name)) return `A field named “${input.name}” already exists.`;
  const id = randomUUID();
  db()
    .prepare(
      `INSERT INTO fields (id, workspace_id, name, type, date_format, number_pattern, number_reset, default_value, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, workspaceId, input.name, input.type, input.date_format, input.number_pattern, input.number_reset,
      input.default_value, userId, now());
  return getField(id)!;
}

/** Update a field. A rename also rewrites {{Old name}} tokens in the workspace's documents. */
export function updateField(field: FieldRow, input: FieldInput): string | null {
  if (nameTaken(field.workspace_id, input.name, field.id)) return `A field named “${input.name}” already exists.`;
  db().transaction(() => {
    db()
      .prepare(
        `UPDATE fields SET name = ?, type = ?, date_format = ?, number_pattern = ?, number_reset = ?, default_value = ?
         WHERE id = ?`,
      )
      .run(input.name, input.type, input.date_format, input.number_pattern, input.number_reset, input.default_value, field.id);
    if (normName(input.name) !== normName(field.name) || input.name !== field.name) {
      const rows = db()
        .prepare("SELECT id, values_json FROM documents WHERE workspace_id = ? AND values_json LIKE '%{{%'")
        .all(field.workspace_id) as { id: string; values_json: string }[];
      const update = db().prepare("UPDATE documents SET values_json = ? WHERE id = ?");
      for (const row of rows) {
        const values = JSON.parse(row.values_json) as Record<string, string>;
        let changed = false;
        for (const [k, v] of Object.entries(values)) {
          const next = v.replace(FIELD_TOKEN_RE, (tok, name: string) =>
            normName(name) === normName(field.name) ? `{{${input.name}}}` : tok,
          );
          if (next !== v) {
            values[k] = next;
            changed = true;
          }
        }
        if (changed) update.run(JSON.stringify(values), row.id);
      }
    }
  })();
  return null;
}

export function deleteField(id: string) {
  db().prepare("DELETE FROM fields WHERE id = ?").run(id);
}

/** How many template marks use each field. */
export function fieldUsage(workspaceId: string): Map<string, number> {
  const rows = db()
    .prepare(
      `SELECT m.field_id, COUNT(*) AS n FROM template_marks m JOIN fields f ON f.id = m.field_id
       WHERE f.workspace_id = ? GROUP BY m.field_id`,
    )
    .all(workspaceId) as { field_id: string; n: number }[];
  return new Map(rows.map((r) => [r.field_id, r.n]));
}

/** The number the next set would get, without consuming it. */
export function previewNextNumber(field: Field): string {
  const d = today(config.timeZone);
  const row = db()
    .prepare("SELECT last_value FROM field_counters WHERE field_id = ? AND period = ?")
    .get(field.id, counterPeriod(field.number_reset, d)) as { last_value: number } | undefined;
  return renderNumber(field.number_pattern, (row?.last_value ?? 0) + 1, d);
}

/** Take the next number for an auto-numbered field (atomic). */
export function takeNextNumber(field: Field): string {
  const d = today(config.timeZone);
  const row = db()
    .prepare(
      `INSERT INTO field_counters (field_id, period, last_value) VALUES (?, ?, 1)
       ON CONFLICT (field_id, period) DO UPDATE SET last_value = last_value + 1
       RETURNING last_value`,
    )
    .get(field.id, counterPeriod(field.number_reset, d)) as { last_value: number };
  return renderNumber(field.number_pattern, row.last_value, d);
}

// ----------------------------------------------------------------- template marks
export function listMarks(templateId: string): Mark[] {
  return db()
    .prepare(`SELECT id, block_id, start, "end", field_id FROM template_marks WHERE template_id = ? ORDER BY block_id, start`)
    .all(templateId) as Mark[];
}

export function addMark(templateId: string, m: Omit<Mark, "id">): Mark {
  const id = randomUUID();
  db()
    .prepare(`INSERT INTO template_marks (id, template_id, block_id, start, "end", field_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, templateId, m.block_id, m.start, m.end, m.field_id, now());
  return { id, ...m };
}

export function deleteMark(templateId: string, markId: string) {
  db().prepare("DELETE FROM template_marks WHERE id = ? AND template_id = ?").run(markId, templateId);
}

// ----------------------------------------------------------------- sets
export function createSet(workspaceId: string, name: string, userId: string): string {
  const id = randomUUID();
  const t = now();
  db()
    .prepare("INSERT INTO sets (id, workspace_id, name, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, workspaceId, name, userId, t, t);
  return id;
}

export function listSets(workspaceId: string): SetRow[] {
  return db()
    .prepare(
      `SELECT s.*, (SELECT COUNT(*) FROM documents d WHERE d.set_id = s.id) AS documents
       FROM sets s WHERE s.workspace_id = ? ORDER BY s.updated_at DESC`,
    )
    .all(workspaceId) as SetRow[];
}

export function getSet(id: string): SetRow | null {
  return (db().prepare("SELECT * FROM sets WHERE id = ?").get(id) as SetRow | undefined) ?? null;
}

export function renameSet(id: string, name: string) {
  db().prepare("UPDATE sets SET name = ?, updated_at = ? WHERE id = ?").run(name, now(), id);
}

export function touchSet(id: string) {
  db().prepare("UPDATE sets SET updated_at = ? WHERE id = ?").run(now(), id);
}

export function deleteSet(id: string) {
  db().transaction(() => {
    db()
      .prepare("DELETE FROM field_values WHERE owner_id = ? OR owner_id IN (SELECT id FROM documents WHERE set_id = ?)")
      .run(id, id);
    db().prepare("DELETE FROM sets WHERE id = ?").run(id);
  })();
}

// ----------------------------------------------------------------- values
/** Field values live on the set, or on the document itself when it isn't in a set. */
export const valueOwner = (doc: Pick<DocumentRow, "id" | "set_id">) => doc.set_id ?? doc.id;

export function getValues(ownerId: string): FieldValues {
  const rows = db().prepare("SELECT field_id, value FROM field_values WHERE owner_id = ?").all(ownerId) as {
    field_id: string;
    value: string;
  }[];
  return Object.fromEntries(rows.map((r) => [r.field_id, r.value]));
}

export function setValues(ownerId: string, values: FieldValues) {
  const stmt = db().prepare(
    `INSERT INTO field_values (owner_id, field_id, value, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (owner_id, field_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  );
  const t = now();
  db().transaction(() => {
    for (const [fieldId, value] of Object.entries(values)) stmt.run(ownerId, fieldId, value, t);
  })();
}

/**
 * Give fields that have no value yet their starting value: the default text, today's date,
 * or the next number. Numbers are taken once per owner, never re-assigned.
 */
export function ensureValues(ownerId: string, fields: Field[], seed: FieldValues = {}): FieldValues {
  const values = getValues(ownerId);
  const fresh: FieldValues = {};
  for (const f of fields) {
    if (values[f.id] !== undefined) continue;
    const value =
      seed[f.id] ??
      (f.type === "number" ? takeNextNumber(f) : f.type === "date" ? today(config.timeZone).iso : f.default_value);
    if (value === "" && f.type === "text") continue;
    fresh[f.id] = value;
  }
  if (Object.keys(fresh).length) setValues(ownerId, fresh);
  return { ...values, ...fresh };
}

export function deleteValuesOf(ownerIds: string[]) {
  const stmt = db().prepare("DELETE FROM field_values WHERE owner_id = ?");
  db().transaction(() => ownerIds.forEach((id) => stmt.run(id)))();
}
