"use client";
// Form-style document editor: every paragraph of the template is a text field, grouped by
// header / body / footer. Edits are autosaved and the preview re-renders as you type.
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applyEdits, extractBlocks, type Block, type Values } from "@/lib/docx/template";
import { baseTexts, computeEdits, referencedFields, type Field, type FieldValues, type Mark } from "@/lib/fields";
import { plainText } from "@/lib/docx/rich";
import { DocxPreview } from "./docx-preview";
import { FieldDialog, FieldValuesList, useFieldValues } from "./fields";
import { RichField, type RichFieldHandle } from "./rich-field";

type Props = {
  documentId: string;
  workspaceId: string;
  workspaceName: string;
  templateId: string;
  templateName: string;
  initialTitle: string;
  initialValues: Values;
  menu: React.ReactNode;
  fields: Field[];
  marks: Mark[];
  fieldValues: FieldValues;
  /** The set this document belongs to (shares its field values), if any. */
  set: { id: string; name: string; documents: number } | null;
};

/** Where an inserted field goes: a paragraph's field (null when only creating a field). */
type InsertTarget = { field: RichFieldHandle | null; selected: string };

type SaveState = "saved" | "dirty" | "saving" | "error";

export function Editor(props: Props) {
  const { documentId, templateId } = props;
  const [template, setTemplate] = useState<Uint8Array | null>(null);
  const [blocks, setBlocks] = useState<Block[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [values, setValues] = useState<Values>(props.initialValues);
  const [title, setTitle] = useState(props.initialTitle);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [preview, setPreview] = useState<Uint8Array | null>(null);
  const [save, setSave] = useState<SaveState>("saved");
  const [showEmpty, setShowEmpty] = useState(false);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [exporting, setExporting] = useState<string | null>(null);
  const [fields, setFields] = useState<Field[]>(props.fields);
  const fv = useFieldValues(props.set ? { type: "set", id: props.set.id } : { type: "document", id: documentId }, props.fieldValues);
  const [insert, setInsert] = useState<InsertTarget | null>(null);
  const [newFieldName, setNewFieldName] = useState<string | undefined>();

  // ---------------------------------------------------------------- load template
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/templates/${templateId}/file`);
        if (!res.ok) throw new Error(`Could not load template (${res.status})`);
        const data = new Uint8Array(await res.arrayBuffer());
        setBlocks(await extractBlocks(data));
        setTemplate(data);
      } catch (e) {
        setLoadError((e as Error).message);
      }
    })();
  }, [templateId]);

  // ---------------------------------------------------------------- live preview
  useEffect(() => {
    if (!template) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const edits = computeEdits(blocks ?? [], values, props.marks, fields, fv.values);
      const out = await applyEdits(template, edits, { focusBlockId: focusId });
      if (!cancelled) setPreview(out);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [template, blocks, values, focusId, props.marks, fields, fv.values]);

  // ---------------------------------------------------------------- autosave
  const pending = useRef<{ title: string; values: Values } | null>(null);
  const inflight = useRef<Promise<void> | null>(null);

  const flush = useCallback(async () => {
    while (inflight.current) await inflight.current;
    const body = pending.current;
    if (!body) return;
    pending.current = null;
    setSave("saving");
    inflight.current = (async () => {
      try {
        const res = await fetch(`/api/documents/${documentId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(String(res.status));
        setSave(pending.current ? "dirty" : "saved");
      } catch {
        pending.current ??= body; // retry with the next change or flush
        setSave("error");
      } finally {
        inflight.current = null;
      }
    })();
    await inflight.current;
  }, [documentId]);

  const lastSaved = useRef(JSON.stringify({ title: props.initialTitle, values: props.initialValues }));
  useEffect(() => {
    const snapshot = JSON.stringify({ title, values });
    if (snapshot === lastSaved.current) return;
    lastSaved.current = snapshot;
    pending.current = { title, values };
    setSave("dirty");
    const t = setTimeout(flush, 700);
    return () => clearTimeout(t);
  }, [title, values, flush]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (pending.current || inflight.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  // ---------------------------------------------------------------- editing
  // A block's starting text: the template text, with marked ranges shown as {{Field}}.
  const bases = useMemo(() => (blocks ? baseTexts(blocks, props.marks, fields) : new Map<string, string>()), [blocks, props.marks, fields]);
  const original = useMemo(
    () => new Map(blocks?.map((b) => [b.id, bases.get(b.id) ?? b.rich]) ?? []),
    [blocks, bases],
  );
  const referenced = useMemo(
    () => (blocks ? referencedFields(blocks, values, props.marks, fields) : { used: [], unknown: [] }),
    [blocks, values, props.marks, fields],
  );

  // Fields that just came into use (inserted or created) get their starting value.
  const ensured = useRef(new Set(Object.keys(props.fieldValues)));
  const { ensure } = fv;
  useEffect(() => {
    const missing = referenced.used.filter((f) => fv.values[f.id] === undefined && !ensured.current.has(f.id));
    if (!missing.length) return;
    missing.forEach((f) => ensured.current.add(f.id));
    ensure(missing.map((f) => f.id));
  }, [referenced.used, fv.values, ensure]);

  const queuedToken = useRef<string | null>(null);
  async function pickField(field: Field, created: boolean) {
    if (created) setFields((list) => [...list, field].sort((a, b) => a.name.localeCompare(b.name)));
    const target = insert;
    if (!target?.field) return;
    queuedToken.current = `{{${field.name}}}`;
    // "Select text → make field": the selected text becomes the value if there is none yet.
    if (target.selected && fv.values[field.id] === undefined && field.type !== "date") {
      ensured.current.add(field.id);
      await fv.ensure([field.id], { [field.id]: target.selected });
    }
  }


  const setText = useCallback(
    (id: string, text: string) => {
      setValues((v) => {
        const next = { ...v };
        if (text === original.get(id)) delete next[id];
        else next[id] = text;
        return next;
      });
    },
    [original],
  );

  const resetAll = () => {
    if (confirm("Discard all edits and go back to the template text?")) setValues({});
  };

  async function download(format: "docx" | "pdf") {
    setExporting(format);
    try {
      await Promise.all([flush(), fv.flush()]);
      const res = await fetch(`/api/documents/${documentId}/export?format=${format}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Export failed (${res.status})`);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `${title.replace(/[\\/:*?"<>|]+/g, " ").trim() || "document"}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setExporting(null);
    }
  }

  // ---------------------------------------------------------------- grouping
  const q = query.trim().toLowerCase();
  const visible = (blocks ?? []).filter((b) => {
    const text = plainText(values[b.id] ?? original.get(b.id) ?? b.rich);
    if (!showEmpty && b.empty && !(b.id in values)) return false;
    return !q || text.toLowerCase().includes(q) || b.style.toLowerCase().includes(q);
  });
  const groups: { label: string; blocks: Block[] }[] = [];
  for (const b of visible) {
    const g = groups.at(-1);
    if (g && g.label === b.regionLabel) g.blocks.push(b);
    else groups.push({ label: b.regionLabel, blocks: [b] });
  }
  const emptyCount = (blocks ?? []).filter((b) => b.empty).length;
  const editedCount = Object.keys(values).length;

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs text-slate-500">
            <Link href={`/w/${props.workspaceId}`} className="hover:text-slate-800">{props.workspaceName}</Link> ·{" "}
            <Link href={`/t/${templateId}`} className="hover:text-slate-800">{props.templateName}</Link>
            {props.set && (
              <>
                {" "}·{" "}
                <Link href={`/s/${props.set.id}`} className="font-medium text-brand-700 hover:underline">{props.set.name}</Link>
              </>
            )}
          </div>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            aria-label="Document title"
            className="-ml-1 w-full max-w-xl truncate rounded px-1 text-lg font-semibold tracking-tight hover:bg-slate-100 focus:bg-white focus:ring-2 focus:ring-brand-100 focus:outline-none"
          />
        </div>
        <SaveBadge state={save === "saved" && fv.state !== "saved" ? (fv.state === "error" ? "error" : "saving") : save} onRetry={() => { flush(); fv.flush(); }} />
        <button className="btn" onClick={() => download("docx")} disabled={!blocks || !!exporting}>
          {exporting === "docx" ? "Preparing…" : <><span className="hidden sm:inline">Download</span> DOCX</>}
        </button>
        <button className="btn btn-primary" onClick={() => download("pdf")} disabled={!blocks || !!exporting}>
          {exporting === "pdf" ? "Making PDF…" : <><span className="hidden sm:inline">Download</span> PDF</>}
        </button>
        {props.menu}
      </div>

      <FieldDialog
        open={!!insert}
        workspaceId={props.workspaceId}
        fields={newFieldName ? [] : fields}
        suggestedName={newFieldName}
        title={insert?.selected ? "Make the selection a shared field" : newFieldName ? "Create field" : "Insert a shared field"}
        hint={
          insert?.selected ? (
            <>
              “{insert.selected.slice(0, 80)}” becomes a field. Its value is filled in everywhere the field is used
              {props.set ? " in this set" : ""}.
            </>
          ) : (
            "Fields are typed once and appear in every document that uses them."
          )
        }
        onClose={() => {
          // Type the token only once the dialog is gone: a modal dialog blocks focus elsewhere.
          const token = queuedToken.current;
          const target = insert?.field;
          queuedToken.current = null;
          setInsert(null);
          if (token && target) requestAnimationFrame(() => target.insert(token));
        }}
        onPick={pickField}
      />

      {/* mobile tabs */}
      <div className="flex border-b border-slate-200 bg-white lg:hidden">
        {(["edit", "preview"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2 text-sm font-medium capitalize ${tab === t ? "border-b-2 border-brand-600 text-brand-700" : "text-slate-500"}`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1">
        {/* fields */}
        <section className={`min-h-0 w-full flex-col border-r border-slate-200 bg-white lg:flex lg:w-[min(46%,720px)] ${tab === "edit" ? "flex" : "hidden"}`}>
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find text…"
              className="input max-w-52 py-1.5"
            />
            {emptyCount > 0 && (
              <label className="flex items-center gap-1.5 text-xs text-slate-600">
                <input type="checkbox" checked={showEmpty} onChange={(e) => setShowEmpty(e.target.checked)} />
                Show empty lines ({emptyCount})
              </label>
            )}
            <div className="flex-1" />
            {editedCount > 0 && (
              <button className="text-xs text-slate-500 hover:text-red-700" onClick={resetAll}>
                Reset {editedCount} edit{editedCount === 1 ? "" : "s"}
              </button>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-24">
            {loadError && <p className="mt-6 rounded-lg bg-red-50 p-4 text-sm text-red-700">{loadError}</p>}
            {!blocks && !loadError && <p className="mt-10 text-center text-sm text-slate-500">Loading template…</p>}
            {blocks && visible.length === 0 && (
              <p className="mt-10 text-center text-sm text-slate-500">Nothing matches “{query}”.</p>
            )}
            {blocks && (referenced.used.length > 0 || referenced.unknown.length > 0) && (
              <div className="mt-4 rounded-xl border border-brand-100 bg-brand-50/60 p-4">
                <div className="mb-3 flex flex-wrap items-baseline gap-x-2">
                  <h3 className="text-sm font-semibold">Shared fields</h3>
                  <span className="text-xs text-slate-500">
                    {props.set ? (
                      <>
                        Shared with {props.set.documents === 1 ? "this document" : `all ${props.set.documents} documents`} in{" "}
                        <Link href={`/s/${props.set.id}`} className="font-medium text-brand-700 hover:underline">{props.set.name}</Link>
                      </>
                    ) : (
                      "Used wherever {{Field}} appears in this document"
                    )}
                  </span>
                </div>
                <FieldValuesList fields={referenced.used} values={fv.values} onChange={fv.update} />
                {referenced.unknown.map((name) => (
                  <p key={name} className="mt-2 text-xs text-amber-700">
                    <code>{`{{${name}}}`}</code> is not a field yet.{" "}
                    <button
                      className="font-medium underline"
                      onClick={() => {
                        setNewFieldName(name);
                        setInsert({ field: null, selected: "" });
                      }}
                    >
                      Create it
                    </button>
                  </p>
                ))}
              </div>
            )}
            {groups.map((g, i) => (
              <div key={`${g.label}-${i}`} className="mt-5">
                <h3 className="sticky top-0 z-10 -mx-4 mb-2 bg-white/95 px-4 py-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase backdrop-blur">
                  {g.label}
                </h3>
                <div className="space-y-2">
                  {g.blocks.map((b) => (
                    <BlockField
                      key={b.id}
                      block={b}
                      value={values[b.id] ?? original.get(b.id) ?? b.rich}
                      base={original.get(b.id) ?? b.rich}
                      edited={b.id in values}
                      focused={focusId === b.id}
                      onFocus={() => setFocusId(b.id)}
                      onChange={(text) => setText(b.id, text)}
                      onInsertField={(field, selected) => {
                        setNewFieldName(undefined);
                        setInsert({ field, selected });
                      }}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* preview */}
        <section className={`min-h-0 min-w-0 flex-1 flex-col bg-slate-200/70 lg:flex ${tab === "preview" ? "flex" : "hidden"}`}>
          <DocxPreview data={preview} focusKey={focusId} className="min-h-0 flex-1 overflow-auto" />
        </section>
      </div>
    </div>
  );
}

function SaveBadge({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  if (state === "error")
    return (
      <button onClick={onRetry} className="text-xs font-medium text-red-600 hover:underline">
        Not saved · retry
      </button>
    );
  const text = { saved: "All changes saved", dirty: "Unsaved changes", saving: "Saving…" }[state];
  return <span className={`text-xs ${state === "saved" ? "text-slate-400" : "text-amber-600"}`}>{text}</span>;
}

// Sizes only: bold / italic come from the document itself.
const KIND_CLASS: Record<string, string> = {
  title: "text-2xl tracking-tight",
  subtitle: "text-lg text-slate-600",
  h1: "text-xl",
  h2: "text-lg",
  h3: "text-base",
  list: "text-sm",
  body: "text-sm leading-relaxed",
};

function BlockField({
  block,
  value,
  base,
  edited,
  focused,
  onFocus,
  onChange,
  onInsertField,
}: {
  block: Block;
  value: string;
  base: string;
  edited: boolean;
  focused: boolean;
  onFocus: () => void;
  onChange: (markup: string) => void;
  onInsertField: (field: RichFieldHandle, selected: string) => void;
}) {
  const handle = useRef<RichFieldHandle>(null);
  const [state, setState] = useState({ b: false, i: false, u: false, selected: false });
  const onSelectionChange = useCallback((s: typeof state) => setState(s), []);

  const kindKey =
    block.kind === "heading" ? (block.level <= 1 ? "h1" : block.level === 2 ? "h2" : "h3") : block.kind;
  const hasTokens = /\[\[[^\]]+\]\]/.test(block.text);
  const tool = (key: "b" | "i" | "u", cmd: "bold" | "italic" | "underline", label: string, cls: string) => (
    <button
      type="button"
      title={`${label} (${typeof navigator !== "undefined" && /Mac/.test(navigator.platform) ? "⌘" : "Ctrl+"}${key.toUpperCase()})`}
      aria-label={label}
      aria-pressed={state[key]}
      className={`h-6 w-6 rounded text-[13px] ${cls} ${state[key] ? "bg-brand-100 text-brand-700" : "text-slate-600 hover:bg-slate-200"}`}
      onMouseDown={(e) => e.preventDefault()} // keep the selection in the field
      onClick={() => handle.current?.format(cmd)}
    >
      {key.toUpperCase()}
    </button>
  );

  return (
    <div
      className={`group rounded-lg border-l-[3px] py-1 pr-1 pl-2 transition ${
        focused ? "border-brand-500 bg-brand-50/60" : edited ? "border-amber-400" : "border-transparent hover:bg-slate-50"
      }`}
    >
      <div className="mb-0.5 flex min-h-6 items-center gap-1.5">
        <span className="chip">{block.style}</span>
        {block.inTable && <span className="chip">Table</span>}
        {block.locked && <span className="chip bg-slate-200">Read-only field</span>}
        {edited && <span className="text-[11px] font-medium text-amber-600">Edited</span>}
        <div className="flex-1" />
        {focused && !block.locked && (
          <div className="flex items-center gap-0.5" role="toolbar" aria-label="Formatting">
            {tool("b", "bold", "Bold", "font-bold")}
            {tool("i", "italic", "Italic", "italic font-serif")}
            {tool("u", "underline", "Underline", "underline")}
            <span className="mx-1 h-4 w-px bg-slate-300" />
            <button
              type="button"
              className="rounded px-1.5 text-[11px] font-medium text-brand-700 hover:bg-brand-100"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                const h = handle.current;
                if (!h) return;
                const selected = h.captureSelection();
                onInsertField(h, selected.trim() ? selected : "");
              }}
            >
              {state.selected ? "Make field" : "+ Field"}
            </button>
          </div>
        )}
        {edited && (
          <button
            className="text-[11px] text-slate-400 opacity-0 group-hover:opacity-100 hover:text-slate-700 focus:opacity-100"
            onClick={() => onChange(base)}
          >
            Reset
          </button>
        )}
      </div>
      <div className="flex gap-1.5">
        {block.kind === "list" && <span className="pt-1.5 text-slate-400">•</span>}
        <RichField
          handleRef={handle}
          value={value}
          readOnly={block.locked}
          onFocus={onFocus}
          onChange={onChange}
          onSelectionChange={onSelectionChange}
          placeholder="(empty line)"
          className={`w-full rounded-md border border-transparent bg-transparent px-1.5 py-1 hover:border-slate-200 focus:border-brand-500 focus:bg-white focus:outline-none ${KIND_CLASS[kindKey]} ${block.locked ? "text-slate-500" : ""}`}
        />
      </div>
      {focused && hasTokens && (
        <p className="mt-1 px-1.5 text-[11px] text-slate-500">
          Items in <code className="rounded bg-slate-100 px-1">[[brackets]]</code> are page numbers, images or fields.
          Keep them where you want them; delete one to remove it.
        </p>
      )}
    </div>
  );
}
