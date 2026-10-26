import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import JSZip from "jszip";
import { applyEdits, extractBlocks } from "../src/lib/docx/template";
import {
  baseTexts,
  computeEdits,
  formatDate,
  markProblem,
  referencedFields,
  renderNumber,
  resolveTokens,
  type Field,
  type Mark,
} from "../src/lib/fields";

const sample = readFileSync(new URL("../fixtures/sample-letter.docx", import.meta.url));

const field = (over: Partial<Field>): Field => ({
  id: "f1",
  name: "Client",
  type: "text",
  date_format: "id_long",
  number_pattern: "{seq:3}",
  number_reset: "yearly",
  default_value: "",
  ...over,
});

test("formats dates and numbers", () => {
  assert.equal(formatDate("2026-10-26", "id_long"), "26 Oktober 2026");
  assert.equal(formatDate("2026-03-05", "dmy"), "05/03/2026");
  assert.equal(formatDate("2026-03-05", "iso"), "2026-03-05");
  const d = { yyyy: "2026", mm: "10", dd: "26" };
  assert.equal(renderNumber("{seq:3}/INV/{roman}/{yyyy}", 7, d), "007/INV/X/2026");
  assert.equal(renderNumber("SK-{yy}{mm}{dd}-{seq}", 12, d), "SK-261026-12");
});

test("resolves tokens by name, case-insensitively; leaves unknown and empty ones", () => {
  const fields = [field({ id: "a", name: "Client name" }), field({ id: "b", name: "Date", type: "date" })];
  assert.equal(resolveTokens("<b>{{Client name}}</b>", fields, { a: "A & B" }, true), "<b>A &amp; B</b>");
  const out = resolveTokens("{{client NAME}} · {{Date}} · {{Nope}} · {{ Date }}", fields, { a: "ACME", b: "2026-01-02" });
  assert.equal(out, "ACME · 2 Januari 2026 · {{Nope}} · 2 Januari 2026");
  assert.equal(resolveTokens("{{Date}}", fields, {}), "{{Date}}");
});

test("marked ranges are replaced in place and keep run formatting", async () => {
  const blocks = await extractBlocks(sample);
  const body = blocks.find((b) => b.text.startsWith("Norflabs will deliver"))!;
  // "the website redesign" is a bold run in the middle of the paragraph.
  const start = body.text.indexOf("the website redesign");
  const marks: Mark[] = [{ id: "m1", block_id: body.id, start, end: start + 20, field_id: "p" }];
  const fields = [field({ id: "p", name: "Project" })];

  assert.equal(baseTexts(blocks, marks, fields).get(body.id), "Norflabs will deliver <b>{{Project}}</b> described in the attached proposal.");
  const edits = computeEdits(blocks, {}, marks, fields, { p: "the mobile app" });
  const out = await applyEdits(sample, edits);
  const xml = await (await JSZip.loadAsync(out)).file("word/document.xml")!.async("string");
  assert.match(xml, /<w:b\/><\/w:rPr><w:t xml:space="preserve">the mobile app<\/w:t>/); // still bold
  assert.equal(
    (await extractBlocks(out)).find((b) => b.id === body.id)!.text,
    "Norflabs will deliver the mobile app described in the attached proposal.",
  );
});

test("a mark spanning several runs collapses into the first run", async () => {
  const blocks = await extractBlocks(sample);
  const body = blocks.find((b) => b.text.startsWith("Norflabs will deliver"))!;
  const start = body.text.indexOf("deliver");
  const end = body.text.indexOf(" described");
  const edits = computeEdits(blocks, {}, [{ id: "m", block_id: body.id, start, end, field_id: "x" }], [field({ id: "x" })], {
    x: "build",
  });
  const after = await extractBlocks(await applyEdits(sample, edits));
  assert.equal(after.find((b) => b.id === body.id)!.text, "Norflabs will build described in the attached proposal.");
});

test("edited blocks resolve tokens; empty values stay visible as tokens", async () => {
  const blocks = await extractBlocks(sample);
  const title = blocks.find((b) => b.kind === "title")!;
  const fields = [field({ id: "n", name: "Number", type: "number" })];
  const edits = computeEdits(blocks, { [title.id]: "Agreement {{Number}}" }, [], fields, { n: "001/SPK/X/2026" });
  assert.equal(edits[title.id], "Agreement 001/SPK/X/2026");
  const empty = computeEdits(blocks, { [title.id]: "Agreement {{Number}}" }, [], fields, {});
  assert.equal(empty[title.id], "Agreement {{Number}}");
});

test("referenced fields and mark validation", async () => {
  const blocks = await extractBlocks(sample);
  const footer = blocks.find((b) => b.region === "footer")!;
  const title = blocks.find((b) => b.kind === "title")!;
  const fields = [field({ id: "a", name: "Client" }), field({ id: "b", name: "Date" })];
  const marks: Mark[] = [{ id: "m", block_id: title.id, start: 0, end: 7, field_id: "b" }];
  const ref = referencedFields(blocks, { [footer.id]: "{{Client}} {{Ghost}}" }, marks, fields);
  assert.deepEqual(ref.used.map((f) => f.id).sort(), ["a", "b"]);
  assert.deepEqual(ref.unknown, ["Ghost"]);

  assert.match(markProblem(footer, 0, 10, [])!, /page number/); // "Page [[PAG"
  assert.equal(markProblem(footer, 0, 4, []), null);
  assert.match(markProblem(title, 3, 9, marks)!, /overlaps/);
  assert.match(markProblem(title, 5, 5, [])!, /Select/);
});
