import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import JSZip from "jszip";
import { applyEdits, extractBlocks, TemplateError } from "../src/lib/docx/template";

const sample = readFileSync(new URL("../fixtures/sample-letter.docx", import.meta.url));

const byText = async (data: Uint8Array | Buffer, text: string) =>
  (await extractBlocks(data)).find((b) => b.text === text);

test("extracts header, body and footer blocks with styles", async () => {
  const blocks = await extractBlocks(sample);
  const regions = blocks.map((b) => b.region);
  assert.equal(regions[0], "header");
  assert.equal(regions.at(-1), "footer");

  const title = blocks.find((b) => b.text === "Service Agreement")!;
  assert.equal(title.kind, "title");
  const h2 = blocks.find((b) => b.text === "1.1 Deliverables")!;
  assert.deepEqual([h2.kind, h2.level, h2.style], ["heading", 2, "Heading 2"]);
  assert.equal(blocks.find((b) => b.text === "Design files")!.kind, "list");
  assert.equal(blocks.find((b) => b.text === "Rp 10.000.000")!.inTable, true);

  const footer = blocks.find((b) => b.region === "footer")!;
  assert.equal(footer.text, "Page [[PAGE]] of [[NUMPAGES]]");
  assert.equal(footer.locked, false);
  assert.equal(blocks.find((b) => b.text.includes("Norflabs will deliver"))!.text,
    "Norflabs will deliver the website redesign described in the attached proposal.");
});

test("applies edits and leaves other paragraphs untouched", async () => {
  const blocks = await extractBlocks(sample);
  const title = blocks.find((b) => b.kind === "title")!;
  const header = blocks.find((b) => b.region === "header")!;
  const out = await applyEdits(sample, {
    [title.id]: "Consulting Agreement",
    [header.id]: "ACME · Confidential",
  });
  const after = await extractBlocks(out);
  assert.equal(after.find((b) => b.id === title.id)!.text, "Consulting Agreement");
  assert.equal(after.find((b) => b.id === title.id)!.kind, "title"); // style kept
  assert.equal(after.find((b) => b.id === header.id)!.text, "ACME · Confidential");
  for (const b of blocks) {
    if (b.id !== title.id && b.id !== header.id) assert.equal(after.find((a) => a.id === b.id)!.text, b.text);
  }

  // Unedited parts are byte-identical.
  const before = await JSZip.loadAsync(sample);
  const zip = await JSZip.loadAsync(out);
  const footerPart = blocks.find((b) => b.region === "footer")!.part;
  assert.equal(await zip.file(footerPart)!.async("string"), await before.file(footerPart)!.async("string"));
});

test("keeps fields when tokens are kept, drops them when removed", async () => {
  const footer = (await extractBlocks(sample)).find((b) => b.region === "footer")!;
  const kept = await applyEdits(sample, { [footer.id]: "Halaman [[PAGE]] dari [[NUMPAGES]]" });
  const zip = await JSZip.loadAsync(kept);
  const xml = await zip.file(footer.part)!.async("string");
  assert.match(xml, /PAGE/);
  assert.match(xml, /NUMPAGES/);
  assert.equal((await byText(kept, "Halaman [[PAGE]] dari [[NUMPAGES]]"))?.id, footer.id);

  const dropped = await applyEdits(sample, { [footer.id]: "Confidential [[PAGE]]" });
  const xml2 = await (await JSZip.loadAsync(dropped)).file(footer.part)!.async("string");
  assert.doesNotMatch(xml2, /NUMPAGES/);
  assert.equal((await byText(dropped, "Confidential [[PAGE]]"))?.id, footer.id);
});

test("edited paragraph takes the first run's formatting, handles newlines and tabs", async () => {
  const sig = (await extractBlocks(sample)).find((b) => b.text === "Hafiz Norman")!;
  const out = await applyEdits(sample, { [sig.id]: "Jane Doe\nDirector\tNorflabs" });
  const xml = await (await JSZip.loadAsync(out)).file("word/document.xml")!.async("string");
  assert.match(xml, /<w:r><w:rPr>[^]*?<w:sz w:val="24"\/>[^]*?<w:t xml:space="preserve">Jane Doe<\/w:t><w:br\/><w:t xml:space="preserve">Director<\/w:t><w:tab\/>/);
  assert.equal((await extractBlocks(out)).find((b) => b.id === sig.id)!.text, "Jane Doe\nDirector\tNorflabs");
});

test("writes text into an empty paragraph and escapes XML", async () => {
  const empty = (await extractBlocks(sample)).filter((b) => b.region === "body" && b.empty).at(-1)!;
  const out = await applyEdits(sample, { [empty.id]: "<b>Tom & Jerry</b>" });
  assert.equal((await extractBlocks(out)).find((b) => b.id === empty.id)!.text, "<b>Tom & Jerry</b>");
});

test("hyperlink paragraphs stay valid after editing", async () => {
  const link = (await extractBlocks(sample)).find((b) => b.text.startsWith("Questions?"))!;
  assert.equal(link.text, "Questions? Visit norflabs.com.");
  const out = await applyEdits(sample, { [link.id]: "Questions? Email us." });
  const xml = await (await JSZip.loadAsync(out)).file("word/document.xml")!.async("string");
  assert.doesNotMatch(xml, /<w:hyperlink[^>]*\/>|<w:hyperlink[^>]*><\/w:hyperlink>/);
  assert.equal((await extractBlocks(out)).find((b) => b.id === link.id)!.text, "Questions? Email us.");
});

test("ignores ids pointing outside word/ parts and bad indexes", async () => {
  const out = await applyEdits(sample, { "../etc/passwd#0": "x", "word/document.xml#99999": "x", junk: "x" });
  assert.deepEqual(
    (await extractBlocks(out)).map((b) => b.text),
    (await extractBlocks(sample)).map((b) => b.text),
  );
});

test("focus bookmark is added for preview", async () => {
  const title = (await extractBlocks(sample)).find((b) => b.kind === "title")!;
  const out = await applyEdits(sample, {}, { focusBlockId: title.id });
  const xml = await (await JSZip.loadAsync(out)).file("word/document.xml")!.async("string");
  assert.match(xml, /w:name="dd-focus"/);
});

test("rejects files that are not Word documents", async () => {
  await assert.rejects(extractBlocks(Buffer.from("hello")), TemplateError);
  const zip = new JSZip();
  zip.file("foo.txt", "x");
  await assert.rejects(extractBlocks(await zip.generateAsync({ type: "uint8array" })), TemplateError);
});
