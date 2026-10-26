// One Word paragraph (<w:p>) as plain editable text.
//
// Text runs become plain text. Everything that is not plain text (page-number fields, images,
// page breaks, footnote marks, equations...) becomes an "atom" shown as a [[TOKEN]] in the
// text. On write, atoms are kept as their original XML nodes wherever the user left the
// token, so a footer "Page [[PAGE]] of [[NUMPAGES]]" keeps working page numbers.
//
// Paragraphs the user did not change are never touched. An edited paragraph keeps its
// paragraph properties (style, alignment, numbering) and takes the character formatting of
// its first text run.
import { child, children, isW, W_NS, wAttr, type XEl } from "./xml";

type TextItem = { kind: "text"; node: XEl; text: string };
type AtomItem = { kind: "atom"; nodes: XEl[]; label: string };
type Item = TextItem | AtomItem;

export type ParagraphInfo = {
  text: string;
  items: Item[];
  /** A field starts or ends outside this paragraph (e.g. a table of contents): read-only. */
  locked: boolean;
};

/** Containers we look through: their runs belong to the paragraph text. */
const TRANSPARENT = new Set(["hyperlink", "smartTag", "ins", "customXml", "sdt", "sdtContent", "moveTo"]);
/** Run children with no visible text that we can safely drop on rewrite. */
const IGNORABLE = new Set(["rPr", "lastRenderedPageBreak", "softHyphen", "proofErr"]);

export const TOKEN_RE = /\[\[([^[\]\n]{1,40})\]\]/g;

function runText(run: XEl): string | null {
  let text = "";
  for (const c of children(run)) {
    if (c.namespaceURI !== W_NS) return null;
    switch (c.localName) {
      case "t":
        text += c.textContent ?? "";
        break;
      case "tab":
      case "ptab":
        text += "\t";
        break;
      case "cr":
        text += "\n";
        break;
      case "br": {
        const type = wAttr(c, "type");
        if (type && type !== "textWrapping") return null; // page / column break
        text += "\n";
        break;
      }
      case "noBreakHyphen":
        text += "‑";
        break;
      default:
        if (!IGNORABLE.has(c.localName ?? "")) return null;
    }
  }
  return text;
}

function atomLabel(nodes: XEl[]): string {
  const first = nodes[0];
  if (first.localName === "oMath" || first.localName === "oMathPara") return "equation";
  if (isW(first, "fldSimple")) return fieldName(wAttr(first, "instr") ?? "");
  let instr = "";
  for (const n of nodes) {
    for (const it of Array.from(n.getElementsByTagNameNS(W_NS, "instrText"))) instr += it.textContent ?? "";
  }
  if (instr.trim()) return fieldName(instr);
  const has = (name: string) => nodes.some((n) => n.getElementsByTagNameNS(W_NS, name).length > 0);
  const hasAny = (name: string) => nodes.some((n) => n.getElementsByTagName(name).length > 0);
  if (has("drawing") || hasAny("pic:pic")) return "image";
  if (has("pict") || hasAny("mc:AlternateContent")) return "shape";
  if (nodes.some((n) => Array.from(n.getElementsByTagNameNS(W_NS, "br")).some((b) => wAttr(b, "type") === "page")))
    return "page break";
  if (has("footnoteReference")) return "footnote";
  if (has("endnoteReference")) return "endnote";
  if (has("sym")) return "symbol";
  if (has("commentReference")) return "comment";
  if (has("object")) return "object";
  return "item";
}

function fieldName(instr: string): string {
  const word = instr.trim().split(/\s+/)[0] ?? "";
  return word ? word.toUpperCase() : "field";
}

function fldChars(run: XEl): string[] {
  return children(run)
    .filter((c) => isW(c, "fldChar"))
    .map((c) => wAttr(c, "fldCharType") ?? "");
}

/** Read a paragraph into editable text + the items needed to write it back. */
export function readParagraph(p: XEl): ParagraphInfo {
  const items: Item[] = [];
  let locked = false;
  let field: XEl[] | null = null;
  let depth = 0;

  const visit = (parent: XEl) => {
    for (const el of children(parent)) {
      if (el.namespaceURI === W_NS && el.localName === "r") {
        const chars = fldChars(el);
        if (field) {
          field.push(el);
          for (const c of chars) depth += c === "begin" ? 1 : c === "end" ? -1 : 0;
          if (depth <= 0) {
            items.push({ kind: "atom", nodes: field, label: atomLabel(field) });
            field = null;
            depth = 0;
          }
          continue;
        }
        if (chars.length) {
          let d = 0;
          for (const c of chars) d += c === "begin" ? 1 : c === "end" ? -1 : 0;
          if (chars[0] !== "begin") locked = true;
          if (d > 0) {
            field = [el];
            depth = d;
          } else {
            items.push({ kind: "atom", nodes: [el], label: atomLabel([el]) });
          }
          continue;
        }
        const text = runText(el);
        if (text === null) items.push({ kind: "atom", nodes: [el], label: atomLabel([el]) });
        else if (text) items.push({ kind: "text", node: el, text });
        continue;
      }
      if (el.namespaceURI === W_NS && TRANSPARENT.has(el.localName ?? "")) {
        if (field) field.push(el);
        else visit(el);
        continue;
      }
      if (el.namespaceURI === W_NS && el.localName === "fldSimple") {
        items.push({ kind: "atom", nodes: [el], label: atomLabel([el]) });
        continue;
      }
      if (el.localName === "oMath" || el.localName === "oMathPara") {
        items.push({ kind: "atom", nodes: [el], label: atomLabel([el]) });
        continue;
      }
      // pPr, bookmarks, w:del, comments ranges...: left exactly where they are.
    }
  };
  visit(p);
  if (field) locked = true;

  const text = items.map((it) => (it.kind === "text" ? it.text : `[[${it.label}]]`)).join("");
  return { text, items, locked };
}

/** Run properties for new text: the first text run's, else the paragraph mark's. */
function templateRPr(p: XEl, info: ParagraphInfo): XEl | null {
  const first = info.items.find((i): i is TextItem => i.kind === "text");
  if (first) {
    const rPr = child(first.node, "rPr");
    return rPr ? (rPr.cloneNode(true) as XEl) : null;
  }
  const pPr = child(p, "pPr");
  const mark = pPr && child(pPr, "rPr");
  if (!mark) return null;
  const rPr = p.ownerDocument!.createElementNS(W_NS, "w:rPr");
  for (const c of children(mark)) {
    if (["ins", "del", "moveFrom", "moveTo", "rPrChange"].includes(c.localName ?? "")) continue;
    rPr.appendChild(c.cloneNode(true));
  }
  return rPr;
}

function makeRun(p: XEl, rPr: XEl | null, text: string): XEl {
  const doc = p.ownerDocument!;
  const run = doc.createElementNS(W_NS, "w:r");
  if (rPr) run.appendChild(rPr.cloneNode(true));
  for (const part of text.split(/(\t|\r?\n)/)) {
    if (!part) continue;
    if (part === "\t") run.appendChild(doc.createElementNS(W_NS, "w:tab"));
    else if (part === "\n" || part === "\r\n") run.appendChild(doc.createElementNS(W_NS, "w:br"));
    else {
      const t = doc.createElementNS(W_NS, "w:t");
      t.setAttribute("xml:space", "preserve");
      t.appendChild(doc.createTextNode(part.replace(/‑/g, "-")));
      run.appendChild(t);
    }
  }
  return run;
}

/** Top-level child of `p` that contains `node`. */
function topLevel(p: XEl, node: XEl): XEl {
  let cur: XEl = node;
  while (cur.parentNode && cur.parentNode !== p) cur = cur.parentNode as XEl;
  return cur;
}

/**
 * Replace the paragraph's text. Returns false when nothing was changed (same text, or the
 * paragraph is locked).
 */
export function writeParagraph(p: XEl, newText: string): boolean {
  const info = readParagraph(p);
  newText = newText.replace(/\r\n?/g, "\n");
  if (info.locked || newText === info.text) return false;

  // Split new text into literal text and references to the original atoms.
  const atoms = info.items.filter((i): i is AtomItem => i.kind === "atom");
  const used = new Set<AtomItem>();
  const segments: (string | AtomItem)[] = [];
  let last = 0;
  for (const m of newText.matchAll(TOKEN_RE)) {
    const atom = atoms.find((a) => !used.has(a) && a.label === m[1]);
    if (!atom) continue; // unknown token: keep as literal text
    used.add(atom);
    if (m.index! > last) segments.push(newText.slice(last, m.index));
    segments.push(atom);
    last = m.index! + m[0].length;
  }
  if (last < newText.length) segments.push(newText.slice(last));

  const rPr = templateRPr(p, info);
  const doc = p.ownerDocument!;
  const anchor = doc.createElementNS(W_NS, "w:proofErr"); // temporary placeholder
  const firstNode = info.items.length
    ? info.items[0].kind === "text"
      ? info.items[0].node
      : info.items[0].nodes[0]
    : null;
  if (firstNode) p.insertBefore(anchor, topLevel(p, firstNode));
  else p.appendChild(anchor);

  // Detach every old item, then rebuild in the new order before the placeholder.
  const containers = new Set<XEl>();
  for (const it of info.items) {
    for (const n of it.kind === "text" ? [it.node] : it.nodes) {
      const parent = n.parentNode as XEl | null;
      if (parent && parent !== p) containers.add(parent);
      parent?.removeChild(n);
    }
  }
  for (const seg of segments) {
    if (typeof seg === "string") p.insertBefore(makeRun(p, rPr, seg), anchor);
    else for (const n of seg.nodes) p.insertBefore(n, anchor);
  }
  p.removeChild(anchor);

  // Drop wrappers (hyperlinks, smart tags...) that are now empty.
  for (const c of containers) {
    let el: XEl | null = c;
    while (el && el !== p && !children(el).some((x) => !isW(x, "rPr") && !isW(x, "sdtPr") && !isW(x, "sdtEndPr"))) {
      const parent = el.parentNode as XEl | null;
      if (isW(el, "sdtContent")) break; // keep content controls
      parent?.removeChild(el);
      el = parent;
    }
  }
  return true;
}
