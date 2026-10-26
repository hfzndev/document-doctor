import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import JSZip from "jszip";
import { canonical, parseMarkup, plainText, replaceRange, toMarkup } from "../src/lib/docx/rich";
import { applyEdits, extractBlocks } from "../src/lib/docx/template";

const sample = readFileSync(new URL("../fixtures/sample-letter.docx", import.meta.url));
const docXml = async (data: Uint8Array) => (await JSZip.loadAsync(data)).file("word/document.xml")!.async("string");
/** The <w:p>...</w:p> that contains `text`. */
const paraXml = (xml: string, text: string) => {
  const i = xml.indexOf(text);
  return xml.slice(Math.max(xml.lastIndexOf("<w:p>", i), xml.lastIndexOf("<w:p ", i)), xml.indexOf("</w:p>", i));
};

test("markup round-trips and merges", () => {
  assert.equal(canonical("a<b>b</b><b>c</b> <i><b>d</b></i>"), "a<b>bc</b> <b><i>d</i></b>");
  assert.equal(plainText("x &lt;y&gt; &amp; <u>z</u>"), "x <y> & z");
  assert.equal(canonical("<b>unclosed"), "<b>unclosed</b>");
  assert.equal(canonical("a < b & </i>c"), "a &lt; b &amp; c");
  assert.equal(toMarkup(parseMarkup("")), "");
});

test("replaceRange keeps the formatting of the replaced text", () => {
  const segs = parseMarkup("Pay <b>Rp 10</b> now");
  assert.equal(toMarkup(replaceRange(segs, 4, 9, "{{Total}}")), "Pay <b>{{Total}}</b> now");
  assert.equal(toMarkup(replaceRange(segs, 13, 13, "!")), "Pay <b>Rp 10</b> now!");
  assert.equal(toMarkup(replaceRange(segs, 0, 13, "X")), "X");
});

test("extracts effective formatting from runs and styles", async () => {
  const blocks = await extractBlocks(sample);
  const body = blocks.find((b) => b.text.startsWith("Norflabs will deliver"))!;
  assert.equal(body.rich, "Norflabs will deliver <b>the website redesign</b> described in the attached proposal.");
  // Heading 1 is bold through its style, not through direct formatting.
  const h1 = blocks.find((b) => b.text === "1. Scope of work")!;
  assert.equal(h1.rich, "<b>1. Scope of work</b>");
  // Subtitle is italic through its style.
  assert.match(blocks.find((b) => b.kind === "subtitle")!.rich, /^<i>/);
});

test("writes bold / italic / underline as direct formatting in schema order", async () => {
  const blocks = await extractBlocks(sample);
  const sig = blocks.find((b) => b.text === "Hafiz Norman")!;
  const out = await applyEdits(sample, { [sig.id]: "Jane <b>Doe</b> <i>CEO</i> <u>Norflabs</u>" });
  const after = (await extractBlocks(out)).find((b) => b.id === sig.id)!;
  assert.equal(after.rich, "Jane <b>Doe</b> <i>CEO</i> <u>Norflabs</u>");
  const xml = paraXml(await docXml(out), "Jane");
  // w:b before w:color / w:sz, w:u after w:sz (CT_RPr order); the run's size is kept.
  assert.match(xml, /<w:rPr><w:b\/><w:color w:val="333333"\/><w:sz w:val="24"\/><\/w:rPr><w:t xml:space="preserve">Doe/);
  assert.match(xml, /<w:rPr><w:color w:val="333333"\/><w:sz w:val="24"\/><w:u w:val="single"\/><\/w:rPr><w:t xml:space="preserve">Norflabs/);
});

test("style formatting is not duplicated, and can be switched off", async () => {
  const blocks = await extractBlocks(sample);
  const h1 = blocks.find((b) => b.text === "1. Scope of work")!;
  const kept = await applyEdits(sample, { [h1.id]: "<b>1. Scope and timeline</b>" });
  assert.doesNotMatch(paraXml(await docXml(kept), "1. Scope and timeline"), /<w:b\/>|<w:b w:val/);
  const off = await applyEdits(sample, { [h1.id]: "1. Scope <b>and</b> timeline" });
  const xml = paraXml(await docXml(off), "1. Scope ");
  assert.match(xml, /<w:b w:val="0"\/><\/w:rPr><w:t xml:space="preserve">1. Scope <\/w:t>/);
  assert.equal((await extractBlocks(off)).find((b) => b.id === h1.id)!.rich, "1. Scope <b>and</b> timeline");
});

test("removing bold from a directly-bold run drops the direct formatting", async () => {
  const blocks = await extractBlocks(sample);
  const body = blocks.find((b) => b.text.startsWith("Norflabs will deliver"))!;
  const out = await applyEdits(sample, { [body.id]: "<b>Norflabs</b> will deliver the website redesign." });
  const after = (await extractBlocks(out)).find((b) => b.id === body.id)!;
  assert.equal(after.rich, "<b>Norflabs</b> will deliver the website redesign.");
  assert.doesNotMatch(paraXml(await docXml(out), "will deliver"), /w:val="0"/);
});

test("unchanged markup leaves the paragraph untouched", async () => {
  const blocks = await extractBlocks(sample);
  const body = blocks.find((b) => b.text.startsWith("Norflabs will deliver"))!;
  const out = await applyEdits(sample, { [body.id]: body.rich.replace("<b>the", "<b>the") });
  assert.equal(await docXml(out), await docXml(new Uint8Array(sample)));
});
