// Template engine: turn a .docx into editable blocks and write edits back.
// Runs unchanged on the server (export) and in the browser (live preview).
import JSZip from "jszip";
import { readParagraph, writeParagraph } from "./paragraph";
import {
  child,
  children,
  descendantsW,
  hasAncestor,
  isW,
  MC_NS,
  parseXml,
  R_NS,
  REL_NS,
  serializeXml,
  W_NS,
  wAttr,
  type XDoc,
  type XEl,
} from "./xml";

export type Region = "header" | "body" | "footer";
export type BlockKind = "title" | "subtitle" | "heading" | "list" | "body";

export type Block = {
  /** Stable within one template file: "<part>#<paragraph index>". */
  id: string;
  part: string;
  region: Region;
  /** e.g. "Header", "Footer (first page)", "Body". */
  regionLabel: string;
  /** Word style name, e.g. "Heading 1", "Title", "Normal". */
  style: string;
  kind: BlockKind;
  level: number;
  inTable: boolean;
  text: string;
  locked: boolean;
  empty: boolean;
};

export type Values = Record<string, string>;

export class TemplateError extends Error {}

const DOCUMENT = "word/document.xml";
const MAX_PARAGRAPHS = 20000;

type PartRef = { part: string; region: Region; label: string };

async function loadZip(data: ArrayBuffer | Uint8Array): Promise<JSZip> {
  try {
    const zip = await JSZip.loadAsync(data);
    if (!zip.file(DOCUMENT)) throw new TemplateError("This file is not a Word document (word/document.xml is missing).");
    return zip;
  } catch (e) {
    if (e instanceof TemplateError) throw e;
    throw new TemplateError("This file is not a valid .docx document.");
  }
}

async function readXml(zip: JSZip, path: string): Promise<XDoc | null> {
  const f = zip.file(path);
  return f ? parseXml(await f.async("string")) : null;
}

function resolveTarget(target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = ["word", ...target.split("/")];
  const out: string[] = [];
  for (const p of parts) {
    if (p === "..") out.pop();
    else if (p && p !== ".") out.push(p);
  }
  return out.join("/");
}

/** Header/footer parts in display order, labelled by the section that uses them. */
async function headerFooterParts(zip: JSZip, doc: XDoc): Promise<PartRef[]> {
  const rels = await readXml(zip, "word/_rels/document.xml.rels");
  const targets = new Map<string, string>();
  if (rels) {
    const list = rels.getElementsByTagNameNS(REL_NS, "Relationship");
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      const target = r.getAttribute("Target");
      if (r.getAttribute("TargetMode") !== "External" && target) targets.set(r.getAttribute("Id") ?? "", resolveTarget(target));
    }
  }
  const sections = descendantsW(doc, "sectPr").filter((s) => !hasAncestor(s, (a) => isW(a, "sectPrChange")));
  const seen = new Set<string>();
  const headers: PartRef[] = [];
  const footers: PartRef[] = [];
  const typeLabel: Record<string, string> = { first: " (first page)", even: " (even pages)", default: "" };
  sections.forEach((sect, i) => {
    for (const ref of children(sect)) {
      const isHeader = isW(ref, "headerReference");
      if (!isHeader && !isW(ref, "footerReference")) continue;
      const part = targets.get(ref.getAttributeNS(R_NS, "id") ?? "");
      if (!part || seen.has(part) || !zip.file(part)) continue;
      seen.add(part);
      const prefix = sections.length > 1 ? `Section ${i + 1} · ` : "";
      const label = `${prefix}${isHeader ? "Header" : "Footer"}${typeLabel[wAttr(ref, "type") ?? "default"] ?? ""}`;
      (isHeader ? headers : footers).push({ part, region: isHeader ? "header" : "footer", label });
    }
  });
  return [...headers, { part: DOCUMENT, region: "body", label: "Body" }, ...footers];
}

/** Every paragraph of a part, in document order. The index is the block id. */
function paragraphs(doc: XDoc): XEl[] {
  const all = descendantsW(doc, "p").filter(
    (p) => !hasAncestor(p, (a) => a.namespaceURI === MC_NS && a.localName === "Fallback"),
  );
  if (all.length > MAX_PARAGRAPHS) throw new TemplateError("This document is too large to edit.");
  return all;
}

type StyleInfo = { names: Map<string, string>; outline: Map<string, number>; defaultName: string };

async function styles(zip: JSZip): Promise<StyleInfo> {
  const info: StyleInfo = { names: new Map(), outline: new Map(), defaultName: "Normal" };
  const doc = await readXml(zip, "word/styles.xml");
  if (!doc) return info;
  for (const s of descendantsW(doc, "style")) {
    if (wAttr(s, "type") !== "paragraph") continue;
    const id = wAttr(s, "styleId") ?? "";
    const name = wAttr(child(s, "name"), "val") ?? id;
    info.names.set(id, name);
    const pPr = child(s, "pPr");
    const lvl = wAttr(pPr && child(pPr, "outlineLvl"), "val");
    if (lvl !== null && lvl !== "9") info.outline.set(id, Number(lvl) + 1);
    if (wAttr(s, "default") === "1" || s.getAttributeNS(W_NS, "default") === "true") info.defaultName = name;
  }
  return info;
}

function prettyStyle(name: string): string {
  // Built-in names are stored lower-case ("heading 1", "footer"); show them like Word does.
  return name === name.toLowerCase() ? name.replace(/\b\w/g, (c) => c.toUpperCase()) : name;
}

function classify(p: XEl, st: StyleInfo): { style: string; kind: BlockKind; level: number } {
  const pPr = child(p, "pPr");
  const styleId = wAttr(pPr && child(pPr, "pStyle"), "val");
  const name = styleId ? st.names.get(styleId) ?? styleId : st.defaultName;
  const lower = name.toLowerCase();
  const style = prettyStyle(name);
  if (lower === "title") return { style, kind: "title", level: 0 };
  if (lower === "subtitle") return { style, kind: "subtitle", level: 0 };
  const heading = /^heading\s*(\d)/.exec(lower);
  const outline = wAttr(pPr && child(pPr, "outlineLvl"), "val");
  const level = heading
    ? Number(heading[1])
    : outline !== null && outline !== "9"
      ? Number(outline) + 1
      : styleId
        ? st.outline.get(styleId) ?? 0
        : 0;
  if (level > 0) return { style, kind: "heading", level };
  if ((pPr && child(pPr, "numPr")) || lower.includes("list")) return { style, kind: "list", level: 0 };
  return { style, kind: "body", level: 0 };
}

/** Extract every paragraph of headers, body and footers as an editable block. */
export async function extractBlocks(data: ArrayBuffer | Uint8Array): Promise<Block[]> {
  const zip = await loadZip(data);
  const main = (await readXml(zip, DOCUMENT))!;
  const st = await styles(zip);
  const blocks: Block[] = [];
  for (const ref of await headerFooterParts(zip, main)) {
    const doc = ref.part === DOCUMENT ? main : await readXml(zip, ref.part);
    if (!doc) continue;
    paragraphs(doc).forEach((p, i) => {
      const info = readParagraph(p);
      blocks.push({
        id: `${ref.part}#${i}`,
        part: ref.part,
        region: ref.region,
        regionLabel: ref.label,
        ...classify(p, st),
        inTable: hasAncestor(p, (a) => isW(a, "tc")),
        text: info.text,
        locked: info.locked,
        empty: info.text.trim() === "",
      });
    });
  }
  return blocks;
}

export type ApplyOptions = {
  /** Preview only: drop a bookmark named "dd-focus" into this block so the UI can find it. */
  focusBlockId?: string | null;
};

/** Write edited text back into the document. Unedited paragraphs are left byte-for-byte. */
export async function applyEdits(
  data: ArrayBuffer | Uint8Array,
  values: Values,
  opts: ApplyOptions = {},
): Promise<Uint8Array> {
  const zip = await loadZip(data);
  const byPart = new Map<string, Map<number, string>>();
  const touch = (part: string) => byPart.get(part) ?? byPart.set(part, new Map()).get(part)!;
  for (const [id, text] of Object.entries(values)) {
    const hash = id.lastIndexOf("#");
    if (hash < 0 || typeof text !== "string") continue;
    touch(id.slice(0, hash)).set(Number(id.slice(hash + 1)), text);
  }
  let focus: { part: string; index: number } | null = null;
  if (opts.focusBlockId) {
    const hash = opts.focusBlockId.lastIndexOf("#");
    focus = { part: opts.focusBlockId.slice(0, hash), index: Number(opts.focusBlockId.slice(hash + 1)) };
    touch(focus.part);
  }

  for (const [part, edits] of byPart) {
    // Only word/*.xml parts that exist can be edited; ids are untrusted input.
    if (!/^word\/[\w.-]+\.xml$/.test(part) || !zip.file(part)) continue;
    const doc = (await readXml(zip, part))!;
    const paras = paragraphs(doc);
    let changed = false;
    for (const [index, text] of edits) {
      const p = paras[index];
      if (p && writeParagraph(p, text)) changed = true;
    }
    if (focus?.part === part && paras[focus.index]) {
      addFocusBookmark(paras[focus.index]);
      changed = true;
    }
    if (changed) zip.file(part, serializeXml(doc));
  }
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

function addFocusBookmark(p: XEl) {
  const doc = p.ownerDocument!;
  const start = doc.createElementNS(W_NS, "w:bookmarkStart");
  start.setAttributeNS(W_NS, "w:id", "999999");
  start.setAttributeNS(W_NS, "w:name", "dd-focus");
  const end = doc.createElementNS(W_NS, "w:bookmarkEnd");
  end.setAttributeNS(W_NS, "w:id", "999999");
  const pPr = child(p, "pPr");
  p.insertBefore(start, pPr ? pPr.nextSibling : p.firstChild);
  p.appendChild(end);
}
