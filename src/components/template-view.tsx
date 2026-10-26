"use client";
// Template page right pane: live preview, or "Shared fields" where text in the template is
// selected and turned into a field (e.g. "001/INV/X/2026" -> {{Document number}}).
import { useEffect, useMemo, useState } from "react";
import { extractBlocks, type Block } from "@/lib/docx/template";
import { marksByBlock, markProblem, type Field, type Mark } from "@/lib/fields";
import { DocxPreview } from "./docx-preview";
import { FieldDialog, TYPE_LABEL } from "./fields";

type Selection = { block: Block; start: number; end: number; text: string; x: number; y: number };

export function TemplateView(props: { templateId: string; workspaceId: string; fields: Field[]; marks: Mark[] }) {
  const [data, setData] = useState<Uint8Array | null>(null);
  const [blocks, setBlocks] = useState<Block[] | null>(null);
  const [tab, setTab] = useState<"preview" | "fields">(props.marks.length ? "fields" : "preview");
  const [fields, setFields] = useState(props.fields);
  const [marks, setMarks] = useState(props.marks);
  const [sel, setSel] = useState<Selection | null>(null);
  const [dialog, setDialog] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/templates/${props.templateId}/file`)
      .then((r) => r.arrayBuffer())
      .then(async (b) => {
        const bytes = new Uint8Array(b);
        setBlocks(await extractBlocks(bytes));
        setData(bytes);
      });
  }, [props.templateId]);

  const byBlock = useMemo(() => marksByBlock(marks), [marks]);
  const fieldsById = useMemo(() => new Map(fields.map((f) => [f.id, f])), [fields]);

  function onMouseUp() {
    const s = window.getSelection();
    if (!s || s.isCollapsed || !s.rangeCount) return setSel(null);
    const range = s.getRangeAt(0);
    const pos = (node: Node, offset: number) => {
      const el = (node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element))?.closest<HTMLElement>("[data-s]");
      return el ? { block: el.closest<HTMLElement>("[data-block]")?.dataset.block, at: Number(el.dataset.s) + offset } : null;
    };
    const a = pos(range.startContainer, range.startOffset);
    const b = pos(range.endContainer, range.endOffset);
    const block = blocks?.find((x) => x.id === a?.block);
    if (!a || !b || !block || a.block !== b.block) return setSel(null);
    const rect = range.getBoundingClientRect();
    let start = a.at;
    let end = b.at;
    // Trim surrounding spaces from the selection.
    while (start < end && /\s/.test(block.text[start])) start++;
    while (end > start && /\s/.test(block.text[end - 1])) end--;
    if (end <= start) return setSel(null);
    setError(markProblem(block, start, end, marks));
    setSel({ block, start, end, text: block.text.slice(start, end), x: rect.left + rect.width / 2, y: rect.top });
  }

  async function addMark(field: Field, created: boolean) {
    if (!sel) return;
    if (created) setFields((l) => [...l, field]);
    const res = await fetch(`/api/templates/${props.templateId}/marks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blockId: sel.block.id, start: sel.start, end: sel.end, fieldId: field.id }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "Could not mark field");
    setMarks((m) => [...m, json as Mark]);
    setSel(null);
    window.getSelection()?.removeAllRanges();
  }

  async function removeMark(mark: Mark) {
    const res = await fetch(`/api/templates/${props.templateId}/marks?mark=${mark.id}`, { method: "DELETE" });
    if (res.ok) setMarks((m) => m.filter((x) => x.id !== mark.id));
  }

  const visible = (blocks ?? []).filter((b) => !b.empty);
  const groups: { label: string; blocks: Block[] }[] = [];
  for (const b of visible) {
    const g = groups.at(-1);
    if (g?.label === b.regionLabel) g.blocks.push(b);
    else groups.push({ label: b.regionLabel, blocks: [b] });
  }

  return (
    <section className="flex min-h-[70vh] min-w-0 flex-1 flex-col bg-slate-200/70 lg:min-h-0">
      <div className="flex gap-1 border-b border-slate-200 bg-white px-4 pt-2">
        {(["preview", "fields"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === t ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800"}`}
          >
            {t === "preview" ? "Preview" : `Shared fields${marks.length ? ` (${marks.length})` : ""}`}
          </button>
        ))}
      </div>

      {tab === "preview" ? (
        <DocxPreview data={data} className="min-h-0 flex-1 overflow-auto" />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto bg-white" onMouseUp={onMouseUp}>
          <div className="mx-auto max-w-3xl px-6 py-6">
            <div className="rounded-xl bg-brand-50 p-4 text-sm text-slate-700">
              <b>Select text that changes per set</b>, such as a document number, a date or a client name, then click{" "}
              <b>Mark as field</b>. Every document made from this template fills it from its set, and documents in
              the same set share the value.
            </div>
            {!blocks && <p className="mt-8 text-center text-sm text-slate-500">Loading…</p>}
            {groups.map((g, i) => (
              <div key={`${g.label}-${i}`} className="mt-6">
                <h3 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">{g.label}</h3>
                <div className="space-y-1">
                  {g.blocks.map((b) => (
                    <BlockText key={b.id} block={b} marks={byBlock.get(b.id) ?? []} fields={fieldsById} onRemove={removeMark} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {sel && tab === "fields" && !dialog && (
        <div
          className="fixed z-40 -translate-x-1/2 -translate-y-full pb-2"
          style={{ left: sel.x, top: sel.y }}
          onMouseUp={(e) => e.stopPropagation()}
        >
          {error ? (
            <div className="max-w-72 rounded-lg bg-slate-900 px-3 py-2 text-xs text-white shadow-lg">{error}</div>
          ) : (
            <button className="btn btn-primary shadow-lg" onMouseDown={(e) => e.preventDefault()} onClick={() => setDialog(true)}>
              Mark as field
            </button>
          )}
        </div>
      )}

      <FieldDialog
        open={dialog}
        workspaceId={props.workspaceId}
        fields={fields}
        title="Mark as shared field"
        hint={sel && <>“{sel.text.slice(0, 80)}” will be filled from the document&apos;s set.</>}
        onClose={() => setDialog(false)}
        onPick={addMark}
      />
    </section>
  );
}

const KIND: Record<string, string> = {
  title: "text-2xl font-semibold",
  subtitle: "text-lg text-slate-600",
  heading: "text-lg font-semibold",
  list: "pl-4",
  body: "",
};

function BlockText({
  block,
  marks,
  fields,
  onRemove,
}: {
  block: Block;
  marks: Mark[];
  fields: Map<string, Field>;
  onRemove: (m: Mark) => void;
}) {
  const parts: React.ReactNode[] = [];
  let pos = 0;
  for (const m of marks) {
    if (m.start > pos) parts.push(<span key={`t${pos}`} data-s={pos}>{block.text.slice(pos, m.start)}</span>);
    const f = fields.get(m.field_id);
    parts.push(
      <span key={m.id} className="mx-0.5 inline-flex items-center gap-1 rounded-md bg-amber-100 px-1.5 py-0.5 align-baseline text-[0.9em] ring-1 ring-amber-300 select-none">
        <span className="text-amber-900 line-through decoration-amber-400/60">{block.text.slice(m.start, m.end)}</span>
        <span className="font-semibold text-amber-900">→ {f?.name ?? "?"}</span>
        {f && f.type !== "text" && <span className="text-[10px] text-amber-700">{TYPE_LABEL[f.type]}</span>}
        <button
          className="ml-0.5 rounded px-1 text-amber-700 hover:bg-amber-200"
          title="Remove field"
          onClick={() => onRemove(m)}
        >
          ×
        </button>
      </span>,
    );
    pos = m.end;
  }
  if (pos < block.text.length) parts.push(<span key={`t${pos}`} data-s={pos}>{block.text.slice(pos)}</span>);

  return (
    <div className="group flex gap-3 rounded-lg px-2 py-1.5 hover:bg-slate-50">
      <span className="chip mt-0.5 h-fit w-24 shrink-0 justify-center truncate">{block.style}</span>
      <div data-block={block.id} className={`min-w-0 flex-1 whitespace-pre-wrap ${KIND[block.kind]} ${block.locked ? "text-slate-400" : ""}`}>
        {parts}
      </div>
    </div>
  );
}
