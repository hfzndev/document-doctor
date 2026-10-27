// Rich text for one paragraph: plain text plus bold / italic / underline, stored as a tiny
// markup string, e.g. "Total: <b>Rp 10.000.000</b>". Only <b>, <i>, <u> and the entities
// &amp; &lt; &gt; have meaning; everything else is literal text. Shared by the editor,
// the preview and the server export.

export type Flags = { b: boolean; i: boolean; u: boolean };
export type Seg = Flags & { text: string };

export const NO_FLAGS: Flags = { b: false, i: false, u: false };
const TAGS = ["b", "i", "u"] as const;

const sameFlags = (a: Flags, b: Flags) => a.b === b.b && a.i === b.i && a.u === b.u;

export function escapeText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Markup -> segments. Unbalanced or unknown tags are treated leniently. */
export function parseMarkup(markup: string): Seg[] {
  const depth = { b: 0, i: 0, u: 0 };
  const segs: Seg[] = [];
  const push = (text: string) => {
    if (!text) return;
    const flags = { b: depth.b > 0, i: depth.i > 0, u: depth.u > 0 };
    const last = segs.at(-1);
    if (last && sameFlags(last, flags)) last.text += text;
    else segs.push({ ...flags, text });
  };
  for (const m of markup.matchAll(/<(\/?)([biu])>|&(amp|lt|gt);|[^<&]+|[<&]/g)) {
    if (m[2]) {
      const tag = m[2] as keyof typeof depth;
      depth[tag] = Math.max(0, depth[tag] + (m[1] ? -1 : 1));
    } else if (m[3]) {
      push(m[3] === "amp" ? "&" : m[3] === "lt" ? "<" : ">");
    } else {
      push(m[0]);
    }
  }
  return segs;
}

/** Segments -> canonical markup (adjacent equal formatting merged). */
export function toMarkup(segs: Seg[]): string {
  let out = "";
  let prev: Seg | null = null;
  const merged: Seg[] = [];
  for (const s of segs) {
    if (!s.text) continue;
    if (prev && sameFlags(prev, s)) prev.text += s.text;
    else merged.push((prev = { ...s }));
  }
  for (const s of merged) {
    const open = TAGS.filter((t) => s[t]);
    out += open.map((t) => `<${t}>`).join("") + escapeText(s.text) + [...open].reverse().map((t) => `</${t}>`).join("");
  }
  return out;
}

export const canonical = (markup: string) => toMarkup(parseMarkup(markup));

export function plainText(markup: string): string {
  return parseMarkup(markup).map((s) => s.text).join("");
}

/**
 * Replace the plain-text range [start, end) with `text`. The new text takes the formatting
 * of the character it replaces (or of the one before it, when inserting at the end).
 */
export function replaceRange(segs: Seg[], start: number, end: number, text: string): Seg[] {
  const out: Seg[] = [];
  let pos = 0;
  let flags: Flags | null = null;
  let inserted = false;
  const insert = () => {
    if (!inserted) out.push({ ...(flags ?? segs.at(-1) ?? NO_FLAGS), text });
    inserted = true;
  };
  for (const s of segs) {
    const a = pos;
    const b = pos + s.text.length;
    pos = b;
    if (b <= start) {
      out.push(s);
      flags = s;
      continue;
    }
    if (a < start) out.push({ ...s, text: s.text.slice(0, start - a) });
    if (a <= start && start < b) {
      flags = s;
      insert();
    }
    if (b > end) out.push({ ...s, text: s.text.slice(Math.max(0, end - a)) });
  }
  insert();
  return out.filter((s) => s.text);
}
