"use client";
// One paragraph as a small rich-text field: bold / italic / underline only. The value is
// rich.ts markup; the DOM is rebuilt from it only when it changes from outside, so typing
// never moves the caret.
import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from "react";
import { parseMarkup, toMarkup, type Flags, type Seg } from "@/lib/docx/rich";

export type RichFieldHandle = {
  /** Remember the current selection (before a dialog steals focus); returns the selected text. */
  captureSelection: () => string;
  /** Put the caret back where it was captured and type `text` there (replacing a selection). */
  insert: (text: string) => void;
  /** Toggle formatting on the selection. */
  format: (cmd: "bold" | "italic" | "underline") => void;
};

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function markupToHtml(markup: string): string {
  const segs = parseMarkup(markup);
  let html = "";
  for (const s of segs) {
    const open = (["b", "i", "u"] as const).filter((t) => s[t]);
    html += open.map((t) => `<${t}>`).join("") + escapeHtml(s.text).replace(/\n/g, "<br>") + [...open].reverse().map((t) => `</${t}>`).join("");
  }
  // A trailing line break needs a second <br> to be visible in contentEditable.
  return segs.at(-1)?.text.endsWith("\n") ? html + "<br>" : html;
}

function domToMarkup(root: HTMLElement): string {
  const segs: Seg[] = [];
  const push = (text: string, f: Flags) => {
    const last = segs.at(-1);
    if (last && last.b === f.b && last.i === f.i && last.u === f.u) last.text += text;
    else segs.push({ ...f, text });
  };
  const text = () => segs.map((s) => s.text).join("");
  const walk = (node: Node, flags: Flags) => {
    for (const n of Array.from(node.childNodes)) {
      if (n.nodeType === Node.TEXT_NODE) {
        if (n.textContent) push(n.textContent, flags);
        continue;
      }
      if (!(n instanceof HTMLElement)) continue;
      const tag = n.tagName;
      if (tag === "BR") {
        push("\n", flags);
        continue;
      }
      const f = { ...flags };
      if (tag === "B" || tag === "STRONG") f.b = true;
      if (tag === "I" || tag === "EM") f.i = true;
      if (tag === "U" || tag === "INS") f.u = true;
      const st = n.style;
      if (st.fontWeight) f.b = st.fontWeight === "bold" || Number(st.fontWeight) >= 600;
      if (st.fontStyle) f.i = st.fontStyle === "italic";
      const deco = st.textDecorationLine || st.textDecoration;
      if (deco) f.u = deco.includes("underline");
      // Browsers sometimes wrap new lines in <div>/<p>: treat those as line breaks.
      if ((tag === "DIV" || tag === "P") && text() && !text().endsWith("\n")) push("\n", flags);
      walk(n, f);
    }
  };
  walk(root, { b: false, i: false, u: false });
  // Drop the placeholder <br> that keeps a trailing line break visible.
  if (root.lastChild?.nodeName === "BR") {
    const last = segs.at(-1);
    if (last?.text.endsWith("\n")) last.text = last.text.slice(0, -1);
  }
  return toMarkup(segs);
}

export function RichField({
  value,
  onChange,
  onFocus,
  readOnly,
  placeholder,
  className = "",
  handleRef,
  onSelectionChange,
}: {
  value: string;
  onChange: (markup: string) => void;
  onFocus?: () => void;
  readOnly?: boolean;
  placeholder?: string;
  className?: string;
  handleRef?: Ref<RichFieldHandle>;
  /** Called with the active formatting and whether text is selected, while focused. */
  onSelectionChange?: (state: Flags & { selected: boolean }) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const emitted = useRef<string | null>(null);
  const saved = useRef<Range | null>(null);
  const [focused, setFocused] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && value !== emitted.current) {
      el.innerHTML = markupToHtml(value);
      emitted.current = value;
    }
  }, [value]);

  const emit = () => {
    const el = ref.current;
    if (!el) return;
    const markup = domToMarkup(el);
    if (markup === emitted.current) return;
    emitted.current = markup;
    onChange(markup);
  };

  const exec = (cmd: string, arg?: string) => {
    document.execCommand("styleWithCSS", false, "false");
    document.execCommand(cmd, false, arg);
    emit();
  };

  useImperativeHandle(handleRef, () => ({
    captureSelection() {
      const el = ref.current;
      const sel = window.getSelection();
      if (el && sel?.rangeCount && el.contains(sel.getRangeAt(0).commonAncestorContainer)) {
        saved.current = sel.getRangeAt(0).cloneRange();
        return sel.toString();
      }
      saved.current = null;
      return "";
    },
    insert(text) {
      const el = ref.current;
      if (!el) return;
      el.focus();
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      if (saved.current) sel.addRange(saved.current);
      else {
        const r = document.createRange();
        r.selectNodeContents(el);
        r.collapse(false);
        sel.addRange(r);
      }
      exec("insertText", text);
    },
    format(cmd) {
      exec(cmd);
    },
  }));

  // Report bold/italic/underline state of the caret for the toolbar.
  useEffect(() => {
    if (!focused || !onSelectionChange) return;
    const update = () => {
      const sel = window.getSelection();
      const inside = !!sel?.rangeCount && !!ref.current?.contains(sel.getRangeAt(0).commonAncestorContainer);
      if (!inside) return;
      onSelectionChange({
        b: document.queryCommandState("bold"),
        i: document.queryCommandState("italic"),
        u: document.queryCommandState("underline"),
        selected: !sel!.isCollapsed && sel!.toString().trim() !== "",
      });
    };
    update();
    document.addEventListener("selectionchange", update);
    return () => document.removeEventListener("selectionchange", update);
  }, [focused, onSelectionChange]);

  return (
    <div
      ref={ref}
      role="textbox"
      aria-multiline="true"
      contentEditable={!readOnly}
      suppressContentEditableWarning
      data-placeholder={placeholder}
      spellCheck
      className={`dd-rich whitespace-pre-wrap break-words ${className}`}
      onInput={emit}
      onFocus={() => {
        setFocused(true);
        onFocus?.();
      }}
      onBlur={() => setFocused(false)}
      onKeyDown={(e) => {
        const mod = e.metaKey || e.ctrlKey;
        const key = e.key.toLowerCase();
        if (mod && (key === "b" || key === "i" || key === "u")) {
          e.preventDefault();
          exec(key === "b" ? "bold" : key === "i" ? "italic" : "underline");
        } else if (e.key === "Enter") {
          // One paragraph = one field; Enter is a line break inside it.
          e.preventDefault();
          exec("insertLineBreak");
        }
      }}
      onPaste={(e) => {
        e.preventDefault();
        exec("insertText", e.clipboardData.getData("text/plain"));
      }}
      onDrop={(e) => e.preventDefault()}
    />
  );
}
