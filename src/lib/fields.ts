// Shared fields: values like a document number or date that are typed once per set and
// appear in every document of that set. Runs in the browser (preview) and on the server
// (export), so both produce the same document.
//
// In editable text a field is written {{Field name}}. A template "mark" turns a character
// range of a template paragraph into a field; when that paragraph is not otherwise edited
// only those characters are replaced, so the rest of the paragraph keeps its formatting.
import { escapeText, parseMarkup, replaceRange, toMarkup } from "./docx/rich";
import type { Block, Edits, Span, Values } from "./docx/template";

export type FieldType = "text" | "date" | "number";
export type DateFormat = "id_long" | "dmy" | "iso";
export type NumberReset = "yearly" | "monthly" | "never";

export type Field = {
  id: string;
  name: string;
  type: FieldType;
  date_format: DateFormat;
  number_pattern: string;
  number_reset: NumberReset;
  default_value: string;
};

export type Mark = { id: string; block_id: string; start: number; end: number; field_id: string };

/** field id -> raw value (text, ISO date, or the assigned number). */
export type FieldValues = Record<string, string>;

export const FIELD_TOKEN_RE = /\{\{([^{}\n]{1,60})\}\}/g;
const HAS_TOKEN_RE = /\{\{[^{}\n]{1,60}\}\}/;
export const FIELD_NAME_RE = /^[^{}[\]<>&\n]{1,60}$/;

export const DATE_FORMATS: Record<DateFormat, string> = {
  id_long: "26 Oktober 2026",
  dmy: "26/10/2026",
  iso: "2026-10-26",
};

const ID_MONTHS = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

export const normName = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

export function formatDate(iso: string, format: DateFormat): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return iso;
  const [, y, mo, d] = m;
  if (format === "iso") return `${y}-${mo}-${d}`;
  if (format === "dmy") return `${d}/${mo}/${y}`;
  return `${Number(d)} ${ID_MONTHS[Number(mo) - 1] ?? mo} ${y}`;
}

export function formatValue(field: Field, raw: string | undefined): string {
  if (raw === undefined || raw === "") return "";
  return field.type === "date" ? formatDate(raw, field.date_format) : raw;
}

export type DateParts = { yyyy: string; mm: string; dd: string };

export function counterPeriod(reset: NumberReset, d: DateParts): string {
  return reset === "yearly" ? d.yyyy : reset === "monthly" ? `${d.yyyy}-${d.mm}` : "all";
}

/**
 * Render a number pattern. Tokens: {seq} {seq:3} (zero padded), {yyyy} {yy} {mm} {dd},
 * {roman} (month as I..XII). Everything else is literal.
 */
export function renderNumber(pattern: string, seq: number, d: DateParts): string {
  return pattern.replace(/\{(seq(?::(\d{1,2}))?|yyyy|yy|mm|dd|roman)\}/g, (_, token: string, pad?: string) => {
    if (token.startsWith("seq")) return String(seq).padStart(pad ? Number(pad) : 0, "0");
    if (token === "yyyy") return d.yyyy;
    if (token === "yy") return d.yyyy.slice(2);
    if (token === "mm") return d.mm;
    if (token === "dd") return d.dd;
    return ROMAN[Number(d.mm) - 1];
  });
}

/** Today's date in a time zone, as parts and ISO. */
export function today(timeZone: string): DateParts & { iso: string } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date())
    .reduce<Record<string, string>>((acc, p) => ((acc[p.type] = p.value), acc), {});
  return { yyyy: parts.year, mm: parts.month, dd: parts.day, iso: `${parts.year}-${parts.month}-${parts.day}` };
}

/** Field names referenced as {{tokens}} in a text. */
export function tokenNames(text: string): string[] {
  return Array.from(text.matchAll(FIELD_TOKEN_RE), (m) => m[1]);
}

/**
 * Replace {{Field name}} tokens with values. Unknown or empty fields are left as tokens.
 * `markup`: the text is rich markup, so values are escaped.
 */
export function resolveTokens(text: string, fields: Field[], values: FieldValues, markup = false): string {
  const byName = new Map(fields.map((f) => [normName(f.name), f]));
  return text.replace(FIELD_TOKEN_RE, (token, name: string) => {
    const field = byName.get(normName(name));
    const value = field && formatValue(field, values[field.id]);
    return value ? (markup ? escapeText(value) : value) : token;
  });
}

export function marksByBlock(marks: Mark[]): Map<string, Mark[]> {
  const map = new Map<string, Mark[]>();
  for (const m of marks) map.set(m.block_id, [...(map.get(m.block_id) ?? []), m].sort((a, b) => a.start - b.start));
  return map;
}

/** Template content of a block (rich markup) with its marked ranges shown as {{Field name}}. */
export function baseText(block: Block, marks: Mark[] | undefined, fieldsById: Map<string, Field>): string {
  if (!marks?.length) return block.rich;
  let segs = parseMarkup(block.rich);
  let floor = Infinity;
  for (const m of [...marks].sort((a, b) => b.start - a.start)) {
    const f = fieldsById.get(m.field_id);
    if (!f || m.end > floor) continue; // overlapping marks: keep the later one
    segs = replaceRange(segs, m.start, m.end, `{{${f.name}}}`);
    floor = m.start;
  }
  return toMarkup(segs);
}

/** Base content (rich markup) for every block that has marks. */
export function baseTexts(blocks: Block[], marks: Mark[], fields: Field[]): Map<string, string> {
  const byId = new Map(fields.map((f) => [f.id, f]));
  const byBlock = marksByBlock(marks);
  const out = new Map<string, string>();
  for (const b of blocks) if (byBlock.has(b.id)) out.set(b.id, baseText(b, byBlock.get(b.id), byId));
  return out;
}

/**
 * Everything needed to produce a document: the user's block edits (relative to the base
 * text) + template marks + field values -> edits for applyEdits().
 */
export function computeEdits(
  blocks: Block[],
  docValues: Values,
  marks: Mark[],
  fields: Field[],
  values: FieldValues,
): Edits {
  const byId = new Map(fields.map((f) => [f.id, f]));
  const byBlock = marksByBlock(marks);
  const edits: Edits = {};
  for (const b of blocks) {
    const edited = docValues[b.id];
    if (edited !== undefined) {
      edits[b.id] = resolveTokens(edited, fields, values, true);
      continue;
    }
    const ms = byBlock.get(b.id);
    if (ms?.length) {
      const spans: Span[] = [];
      for (const m of ms) {
        const f = byId.get(m.field_id);
        if (f) spans.push({ start: m.start, end: m.end, text: formatValue(f, values[f.id]) || `{{${f.name}}}` });
      }
      edits[b.id] = spans;
    } else if (HAS_TOKEN_RE.test(b.text)) {
      // The template itself contains {{tokens}}.
      edits[b.id] = resolveTokens(b.rich, fields, values, true);
    }
  }
  return edits;
}

/** Fields used by a document (template marks + tokens in base/edited text). */
export function referencedFields(
  blocks: Block[],
  docValues: Values,
  marks: Mark[],
  fields: Field[],
): { used: Field[]; unknown: string[] } {
  const byName = new Map(fields.map((f) => [normName(f.name), f]));
  const ids = new Set(marks.map((m) => m.field_id));
  const unknown = new Set<string>();
  const bases = baseTexts(blocks, marks, fields);
  for (const b of blocks) {
    for (const name of tokenNames(docValues[b.id] ?? bases.get(b.id) ?? b.text)) {
      const f = byName.get(normName(name));
      if (f) ids.add(f.id);
      else unknown.add(name.trim());
    }
  }
  return { used: fields.filter((f) => ids.has(f.id)), unknown: [...unknown] };
}

/** Text ranges that a mark may not cut through: the [[atom]] tokens. */
export function markProblem(block: Block, start: number, end: number, others: Mark[]): string | null {
  if (block.locked) return "This paragraph is read-only.";
  if (!(start >= 0 && end > start && end <= block.text.length)) return "Select some text first.";
  for (const m of block.text.matchAll(/\[\[[^[\]\n]{1,40}\]\]/g)) {
    const a = m.index!;
    const b = a + m[0].length;
    if (a < end && b > start) return "The selection includes a page number, image or other item. Select only text.";
  }
  if (others.some((m) => m.block_id === block.id && m.start < end && m.end > start)) {
    return "The selection overlaps a field that is already marked.";
  }
  return null;
}
