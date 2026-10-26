// Small DOM helpers shared by the server and the browser (both use @xmldom/xmldom so
// extraction and patching enumerate paragraphs identically).
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import type { Document, Element, Node } from "@xmldom/xmldom";

export const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
export const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
export const MC_NS = "http://schemas.openxmlformats.org/markup-compatibility/2006";
export const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";

export type XDoc = Document;
export type XEl = Element;
export type XNode = Node;

export function parseXml(text: string): XDoc {
  return new DOMParser().parseFromString(text, "text/xml");
}

export function serializeXml(doc: XDoc): string {
  return new XMLSerializer().serializeToString(doc);
}

export function isEl(node: unknown): node is XEl {
  return !!node && (node as { nodeType?: number }).nodeType === 1;
}

/** True when `el` is the WordprocessingML element `w:<name>`. */
export function isW(node: unknown, name: string): node is XEl {
  return isEl(node) && node.namespaceURI === W_NS && node.localName === name;
}

export function children(el: XEl): XEl[] {
  const out: XEl[] = [];
  for (let n = el.firstChild; n; n = n.nextSibling) if (isEl(n)) out.push(n);
  return out;
}

export function child(el: XEl, name: string): XEl | null {
  for (let n = el.firstChild; n; n = n.nextSibling) if (isW(n, name)) return n;
  return null;
}

export function wAttr(el: XEl | null, name: string): string | null {
  if (!el) return null;
  return el.getAttributeNS(W_NS, name) ?? el.getAttribute(`w:${name}`);
}

export function descendantsW(root: XEl | XDoc, name: string): XEl[] {
  const list = root.getElementsByTagNameNS(W_NS, name);
  const out: XEl[] = [];
  for (let i = 0; i < list.length; i++) out.push(list[i] as XEl);
  return out;
}

export function hasAncestor(el: XEl, pred: (a: XEl) => boolean, stop?: XEl): boolean {
  for (let a = el.parentNode; a && a !== stop; a = a.parentNode) {
    if (isEl(a) && pred(a)) return true;
  }
  return false;
}
