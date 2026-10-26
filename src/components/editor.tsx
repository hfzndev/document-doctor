"use client";
// Form-style document editor: every paragraph of the template is a text field, grouped by
// header / body / footer. Edits are autosaved and the preview re-renders as you type.
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applyEdits, extractBlocks, type Block, type Values } from "@/lib/docx/template";
import { DocxPreview } from "./docx-preview";

type Props = {
  documentId: string;
  workspaceId: string;
  workspaceName: string;
  templateId: string;
  templateName: string;
  initialTitle: string;
  initialValues: Values;
  menu: React.ReactNode;
};

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
      const out = await applyEdits(template, values, { focusBlockId: focusId });
      if (!cancelled) setPreview(out);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [template, values, focusId]);

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
  const original = useMemo(() => new Map(blocks?.map((b) => [b.id, b.text]) ?? []), [blocks]);

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
      await flush();
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
    const text = values[b.id] ?? b.text;
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
          </div>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            aria-label="Document title"
            className="-ml-1 w-full max-w-xl truncate rounded px-1 text-lg font-semibold tracking-tight hover:bg-slate-100 focus:bg-white focus:ring-2 focus:ring-brand-100 focus:outline-none"
          />
        </div>
        <SaveBadge state={save} onRetry={flush} />
        <button className="btn" onClick={() => download("docx")} disabled={!blocks || !!exporting}>
          {exporting === "docx" ? "Preparing…" : <><span className="hidden sm:inline">Download</span> DOCX</>}
        </button>
        <button className="btn btn-primary" onClick={() => download("pdf")} disabled={!blocks || !!exporting}>
          {exporting === "pdf" ? "Making PDF…" : <><span className="hidden sm:inline">Download</span> PDF</>}
        </button>
        {props.menu}
      </div>

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
                      value={values[b.id] ?? b.text}
                      edited={b.id in values}
                      focused={focusId === b.id}
                      onFocus={() => setFocusId(b.id)}
                      onChange={(text) => setText(b.id, text)}
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

const KIND_CLASS: Record<string, string> = {
  title: "text-2xl font-semibold tracking-tight",
  subtitle: "text-lg text-slate-600",
  h1: "text-xl font-semibold",
  h2: "text-lg font-semibold",
  h3: "text-base font-semibold",
  list: "text-sm",
  body: "text-sm leading-relaxed",
};

function BlockField({
  block,
  value,
  edited,
  focused,
  onFocus,
  onChange,
}: {
  block: Block;
  value: string;
  edited: boolean;
  focused: boolean;
  onFocus: () => void;
  onChange: (text: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const grow = () => {
      if (!el.offsetParent) return; // hidden (mobile preview tab): measure when shown
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight + 2}px`;
    };
    grow();
    const ro = new ResizeObserver(grow);
    ro.observe(el);
    return () => ro.disconnect();
  }, [value]);

  const kindKey =
    block.kind === "heading" ? (block.level <= 1 ? "h1" : block.level === 2 ? "h2" : "h3") : block.kind;
  const hasTokens = /\[\[[^\]]+\]\]/.test(block.text);

  return (
    <div
      className={`group rounded-lg border-l-[3px] py-1 pr-1 pl-2 transition ${
        focused ? "border-brand-500 bg-brand-50/60" : edited ? "border-amber-400" : "border-transparent hover:bg-slate-50"
      }`}
    >
      <div className="mb-0.5 flex items-center gap-1.5">
        <span className="chip">{block.style}</span>
        {block.inTable && <span className="chip">Table</span>}
        {block.locked && <span className="chip bg-slate-200">Read-only field</span>}
        {edited && <span className="text-[11px] font-medium text-amber-600">Edited</span>}
        <div className="flex-1" />
        {edited && (
          <button
            className="text-[11px] text-slate-400 opacity-0 group-hover:opacity-100 hover:text-slate-700 focus:opacity-100"
            onClick={() => onChange(block.text)}
          >
            Reset
          </button>
        )}
      </div>
      <div className="flex gap-1.5">
        {block.kind === "list" && <span className="pt-1.5 text-slate-400">•</span>}
        <textarea
          ref={ref}
          rows={1}
          value={value}
          readOnly={block.locked}
          onFocus={onFocus}
          onChange={(e) => onChange(e.target.value)}
          placeholder="(empty line)"
          className={`w-full resize-none overflow-hidden rounded-md border border-transparent bg-transparent px-1.5 py-1 hover:border-slate-200 focus:border-brand-500 focus:bg-white focus:outline-none ${KIND_CLASS[kindKey]} ${block.locked ? "text-slate-500" : ""}`}
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
