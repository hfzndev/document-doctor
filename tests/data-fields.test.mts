// Runs against a throwaway database (DATA_DIR is set before the data modules load).
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { FieldRow } from "../src/lib/data-fields";

process.env.DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "dd-test-"));
const data = await import("../src/lib/data");
const fd = await import("../src/lib/data-fields");
const { today, renderNumber } = await import("../src/lib/fields");

const user = data.upsertUser("dev:t@example.com", "t@example.com", "T");
const ws = data.createWorkspace(user.id, "WS");
const input = (over: Record<string, unknown>) => {
  const parsed = fd.parseFieldInput({ name: "Number", type: "number", number_pattern: "{seq:3}/INV/{roman}/{yyyy}", ...over });
  assert.notEqual(typeof parsed, "string", String(parsed));
  return parsed as Exclude<typeof parsed, string>;
};

test("auto numbers increase per set and are assigned once", () => {
  const num = fd.createField(ws, input({}), user.id) as FieldRow;
  const d = today("Asia/Jakarta");
  const a = fd.createSet(ws, "A", user.id);
  const b = fd.createSet(ws, "B", user.id);
  assert.equal(fd.previewNextNumber(num), renderNumber(num.number_pattern, 1, d));
  assert.equal(fd.ensureValues(a, [num])[num.id], renderNumber(num.number_pattern, 1, d));
  assert.equal(fd.ensureValues(a, [num])[num.id], renderNumber(num.number_pattern, 1, d)); // not re-taken
  assert.equal(fd.ensureValues(b, [num])[num.id], renderNumber(num.number_pattern, 2, d));
});

test("date fields start at today; text fields use their default", () => {
  const date = fd.createField(ws, input({ name: "Date", type: "date" }), user.id) as FieldRow;
  const company = fd.createField(ws, input({ name: "Company", type: "text", default_value: "Norflabs" }), user.id) as FieldRow;
  const client = fd.createField(ws, input({ name: "Client", type: "text" }), user.id) as FieldRow;
  const set = fd.createSet(ws, "C", user.id);
  const v = fd.ensureValues(set, [date, company, client]);
  assert.equal(v[date.id], today("Asia/Jakarta").iso);
  assert.equal(v[company.id], "Norflabs");
  assert.equal(v[client.id], undefined); // empty text stays unset
  assert.equal(fd.ensureValues(set, [client], { [client.id]: "ACME" })[client.id], "ACME");
});

test("validates field input and unique names", () => {
  assert.match(String(fd.parseFieldInput({ name: "Bad {name}", type: "text" })), /Field names/);
  assert.match(String(fd.parseFieldInput({ name: "N", type: "number", number_pattern: "INV" })), /\{seq\}/);
  assert.match(String(fd.createField(ws, input({ name: "number" }), user.id)), /already exists/);
});

test("renaming a field rewrites tokens in documents", () => {
  const f = fd.createField(ws, input({ name: "Project", type: "text" }), user.id) as FieldRow;
  const tpl = crypto.randomUUID();
  data.createTemplate({ id: tpl, workspace_id: ws, name: "T", description: "", file_name: "t.docx", file_size: 1, block_count: 1, created_by: user.id });
  const doc = data.createDocument(ws, tpl, "D", user.id);
  data.updateDocument(doc, { values: { "word/document.xml#0": "About {{project}} and {{Other}}" } }, user.id);
  assert.equal(fd.updateField(f, input({ name: "Project name", type: "text" })), null);
  assert.equal(
    JSON.parse(data.getDocument(doc)!.values_json)["word/document.xml#0"],
    "About {{Project name}} and {{Other}}",
  );
});

test("documents in a set share values; standalone ones own theirs", () => {
  const tpl = data.listTemplates(ws)[0];
  const set = fd.createSet(ws, "S", user.id);
  const inSet = data.getDocument(data.createDocument(ws, tpl.id, "x", user.id, set))!;
  const alone = data.getDocument(data.createDocument(ws, tpl.id, "y", user.id))!;
  assert.equal(fd.valueOwner(inSet), set);
  assert.equal(fd.valueOwner(alone), alone.id);
  fd.deleteSet(set);
  assert.equal(data.getDocument(inSet.id), null); // documents go with the set
  assert.notEqual(data.getDocument(alone.id), null);
});
