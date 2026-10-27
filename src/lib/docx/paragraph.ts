// One Word paragraph (<w:p>) as editable rich text (see rich.ts: text + <b> <i> <u>).
//
// Text runs become text; their effective bold / italic / underline (direct formatting, then
// the character style, then the paragraph style, then the document defaults) becomes markup.
// Everything that is not plain text (page-number fields, images, page breaks, footnote
// marks, equations...) becomes an "atom" shown as a [[TOKEN]] in the text. On write, atoms
// are kept as their original XML nodes wherever the user left the token, so a footer
// "Page [[PAGE]] of [[NUMPAGES]]" keeps working page numbers.
//
// Paragraphs the user did not change are never touched. An edited paragraph keeps its
// paragraph properties (style, alignment, numbering) and takes the other character
// formatting (font, size, colour...) of its first text run.
import { canonical, parseMarkup, toMarkup, type Flags, type Seg } from "./rich";
import { child, children, isW, W_NS, wAttr, type XEl } from "./xml";

/** Bold / italic / underline defined by styles, used to resolve a run's effective formatting. */
export type FormatContext = {
  styles: Map<string, { basedOn: string | null; flags: Partial<Flags> }>;
  defaults: Partial<Flags>;
  defaultParagraphStyle: string | null;
};

export const EMPTY_FORMAT: FormatContext = { styles: new Map(), defaults: {}, defaultParagraphStyle: null };

type TextItem = { kind: "text"; node: XEl; text: string; flags: Flags };
type AtomItem = { kind: "atom"; nodes: XEl[]; label: string };
type Item = TextItem | AtomItem;

export type ParagraphInfo = {
  /** Plain text (offsets of template marks refer to this). */
  text: string;
  /** The same text as markup with bold / italic / underline. */
  rich: string;
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

/** w:b / w:i / w:u inside an rPr-like element: true, false, or undefined when not set. */
export function readFlags(rPr: XEl | null): Partial<Flags> {
  const out: Partial<Flags> = {};
  if (!rPr) return out;
  for (const tag of ["b", "i"] as const) {
    const el = child(rPr, tag);
    if (el) out[tag] = !["0", "false", "off"].includes(wAttr(el, "val") ?? "1");
  }
  const u = child(rPr, "u");
  if (u) out.u = (wAttr(u, "val") ?? "single") !== "none";
  return out;
}

/** Formatting a run would have without its own w:b / w:i / w:u. */
function inheritedFlags(p: XEl, rPr: XEl | null, ctx: FormatContext): Flags {
  const out: Partial<Flags> = {};
  const apply = (styleId: string | null) => {
    for (let id = styleId, guard = 0; id && guard < 20; guard++) {
      const st = ctx.styles.get(id);
      if (!st) break;
      for (const k of ["b", "i", "u"] as const) if (out[k] === undefined && st.flags[k] !== undefined) out[k] = st.flags[k];
      id = st.basedOn;
    }
  };
  apply(wAttr(rPr && child(rPr, "rStyle"), "val"));
  const pPr = child(p, "pPr");
  apply(wAttr(pPr && child(pPr, "pStyle"), "val") ?? ctx.defaultParagraphStyle);
  return { b: out.b ?? ctx.defaults.b ?? false, i: out.i ?? ctx.defaults.i ?? false, u: out.u ?? ctx.defaults.u ?? false };
}

function effectiveFlags(p: XEl, rPr: XEl | null, ctx: FormatContext): Flags {
  return { ...inheritedFlags(p, rPr, ctx), ...readFlags(rPr) } as Flags;
}

// CT_RPr is an ordered sequence; Word rejects files with children out of order.
const RPR_ORDER = [
  "rStyle", "rFonts", "b", "bCs", "i", "iCs", "caps", "smallCaps", "strike", "dstrike", "outline", "shadow",
  "emboss", "imprint", "noProof", "snapToGrid", "vanish", "webHidden", "color", "spacing", "w", "kern",
  "position", "sz", "szCs", "highlight", "u", "effect", "bdr", "shd", "fitText", "vertAlign", "rtl", "cs", "em",
  "lang", "eastAsianLayout", "specVanish", "oMath",
];

function setRPrChild(rPr: XEl, tag: string, val: string | null) {
  const doc = rPr.ownerDocument!;
  const old = child(rPr, tag);
  if (old) rPr.removeChild(old);
  const el = doc.createElementNS(W_NS, `w:${tag}`);
  if (val !== null) el.setAttributeNS(W_NS, "w:val", val);
  const rank = RPR_ORDER.indexOf(tag);
  const next = children(rPr).find((c) => {
    const r = RPR_ORDER.indexOf(c.localName ?? "");
    return r > rank || r === -1;
  });
  rPr.insertBefore(el, next ?? null);
}

/** rPr for new text with the wanted formatting, adding direct formatting only where needed. */
function rPrWithFlags(p: XEl, base: XEl | null, want: Flags, ctx: FormatContext): XEl | null {
  const rPr = (base?.cloneNode(true) as XEl | undefined) ?? p.ownerDocument!.createElementNS(W_NS, "w:rPr");
  const inherited = inheritedFlags(p, rPr, ctx);
  const direct = readFlags(rPr);
  for (const k of ["b", "i", "u"] as const) {
    const current = direct[k] ?? inherited[k];
    if (current === want[k]) continue;
    if (want[k] === inherited[k]) {
      const el = child(rPr, k);
      if (el) rPr.removeChild(el);
    } else if (k === "u") {
      setRPrChild(rPr, "u", want.u ? "single" : "none");
    } else {
      setRPrChild(rPr, k, want[k] ? null : "0");
    }
  }
  return children(rPr).length ? rPr : null;
}

function fldChars(run: XEl): string[] {
  return children(run)
    .filter((c) => isW(c, "fldChar"))
    .map((c) => wAttr(c, "fldCharType") ?? "");
}

/** Read a paragraph into editable text + the items needed to write it back. */
export function readParagraph(p: XEl, ctx: FormatContext = EMPTY_FORMAT): ParagraphInfo {
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
        else if (text) items.push({ kind: "text", node: el, text, flags: effectiveFlags(p, child(el, "rPr"), ctx) });
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
  const segs: Seg[] = items.map((it) =>
    it.kind === "text" ? { ...it.flags, text: it.text } : { b: false, i: false, u: false, text: `[[${it.label}]]` },
  );
  return { text, rich: toMarkup(segs), items, locked };
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
  const run = p.ownerDocument!.createElementNS(W_NS, "w:r");
  if (rPr) run.appendChild(rPr.cloneNode(true));
  appendText(run, text);
  return run;
}

/** Append text to a run as w:t / w:tab / w:br children. */
function appendText(run: XEl, text: string) {
  const doc = run.ownerDocument!;
  for (const part of text.split(/(\t|\r?\n)/)) {
    if (!part) continue;
    if (part === "\t") run.appendChild(doc.createElementNS(W_NS, "w:tab"));
    else if (part === "\n" || part === "\r\n") run.appendChild(doc.createElementNS(W_NS, "w:br"));
    else {
      const t = doc.createElementNS(W_NS, "w:t");
      t.setAttribute("xml:space", "preserve");
      t.appendChild(doc.createTextNode(part.replace(/\u2011/g, "-")));
      run.appendChild(t);
    }
  }
}

/** Replace a text run's content, keeping its formatting (w:rPr). */
function setRunText(run: XEl, text: string) {
  for (const c of children(run)) if (!isW(c, "rPr")) run.removeChild(c);
  if (text) appendText(run, text);
  else run.parentNode?.removeChild(run);
}

export type Span = { start: number; end: number; text: string };

/**
 * Replace character ranges of the paragraph text (offsets into readParagraph().text) while
 * keeping every run's formatting: the replacement takes the formatting of the character it
 * starts at. Spans must not cut through [[tokens]]; such spans are skipped.
 */
export function writeSpans(p: XEl, spans: Span[]): boolean {
  let changed = false;
  for (const span of [...spans].sort((a, b) => b.start - a.start)) {
    const info = readParagraph(p);
    if (info.locked || span.start < 0 || span.end > info.text.length || span.start >= span.end) continue;
    let pos = 0;
    const hits: { item: TextItem; from: number; to: number }[] = [];
    let blocked = false;
    for (const it of info.items) {
      const len = it.kind === "text" ? it.text.length : it.label.length + 4;
      const a = pos;
      const b = pos + len;
      pos = b;
      if (b <= span.start || a >= span.end) continue;
      if (it.kind === "atom") {
        blocked = true;
        break;
      }
      hits.push({ item: it, from: Math.max(0, span.start - a), to: Math.min(len, span.end - a) });
    }
    if (blocked || !hits.length) continue;
    hits.forEach((h, i) => {
      const t = h.item.text;
      setRunText(h.item.node, t.slice(0, h.from) + (i === 0 ? span.text : "") + t.slice(h.to));
    });
    changed = true;
  }
  return changed;
}

/** Top-level child of `p` that contains `node`. */
function topLevel(p: XEl, node: XEl): XEl {
  let cur: XEl = node;
  while (cur.parentNode && cur.parentNode !== p) cur = cur.parentNode as XEl;
  return cur;
}

/**
 * Replace the paragraph's content with `markup` (rich.ts format). Returns false when nothing
 * was changed (same content, or the paragraph is locked).
 */
export function writeParagraph(p: XEl, markup: string, ctx: FormatContext = EMPTY_FORMAT): boolean {
  const info = readParagraph(p, ctx);
  const next = canonical(markup.replace(/\r\n?/g, "\n"));
  if (info.locked || next === info.rich) return false;

  // Split new content into formatted text and references to the original atoms.
  const atoms = info.items.filter((i): i is AtomItem => i.kind === "atom");
  const used = new Set<AtomItem>();
  const segments: (Seg | AtomItem)[] = [];
  for (const seg of parseMarkup(next)) {
    let last = 0;
    for (const m of seg.text.matchAll(TOKEN_RE)) {
      const atom = atoms.find((a) => !used.has(a) && a.label === m[1]);
      if (!atom) continue; // unknown token: keep as literal text
      used.add(atom);
      if (m.index! > last) segments.push({ ...seg, text: seg.text.slice(last, m.index) });
      segments.push(atom);
      last = m.index! + m[0].length;
    }
    if (last < seg.text.length) segments.push({ ...seg, text: seg.text.slice(last) });
  }

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
    if ("kind" in seg) for (const n of seg.nodes) p.insertBefore(n, anchor);
    else p.insertBefore(makeRun(p, rPrWithFlags(p, rPr, seg, ctx), seg.text), anchor);
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
