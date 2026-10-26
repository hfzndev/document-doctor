"use client";
// Renders a .docx in the browser (docx-preview), scaled to fit the pane. Each render goes
// into a fresh node that replaces the old one, so typing doesn't flash an empty pane.
import { useEffect, useRef, useState } from "react";

type Props = {
  data: Uint8Array | null;
  /** Changes when the focused block changes; scrolls the "dd-focus" bookmark into view. */
  focusKey?: string | null;
  className?: string;
};

export function DocxPreview({ data, focusKey, className = "" }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const generation = useRef(0);
  const lastFocus = useRef<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el || !data) return;
    const gen = ++generation.current;
    (async () => {
      try {
        const { renderAsync } = await import("docx-preview");
        const next = document.createElement("div");
        await renderAsync(data, next, next, {
          className: "docx",
          inWrapper: true,
          breakPages: true,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
          renderEndnotes: true,
          ignoreLastRenderedPageBreak: true,
          useBase64URL: true,
        });
        if (gen !== generation.current) return;
        const scroller = el.parentElement;
        const top = scroller?.scrollTop ?? 0;
        el.replaceChildren(next);
        fit(el);
        if (scroller) scroller.scrollTop = top;
        setError(null);

        const marker = next.querySelector("#dd-focus");
        const para = marker?.closest("p");
        para?.classList.add("dd-focus-para");
        if (para && focusKey !== lastFocus.current) {
          para.scrollIntoView({ block: "center", behavior: "smooth" });
        }
        lastFocus.current = focusKey;
      } catch (e) {
        if (gen === generation.current) setError((e as Error).message || "Could not render preview");
      }
    })();
  }, [data, focusKey]);

  // Re-fit on resize.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(() => fit(el));
    ro.observe(el.parentElement ?? el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className={`dd-preview relative ${className}`}>
      {!data && !error && <div className="p-10 text-center text-sm text-slate-500">Loading preview…</div>}
      {error && <div className="m-6 rounded-lg bg-red-50 p-4 text-sm text-red-700">Preview failed: {error}</div>}
      <div ref={host} />
    </div>
  );
}

/** Scale pages down (never up) so the widest page fits the available width. */
function fit(el: HTMLElement) {
  const wrapper = el.querySelector<HTMLElement>(".docx-wrapper");
  if (!wrapper) return;
  wrapper.style.zoom = "1";
  const pages = Array.from(wrapper.querySelectorAll<HTMLElement>("section.docx"));
  const widest = Math.max(0, ...pages.map((p) => p.offsetWidth));
  const available = (el.parentElement?.clientWidth ?? el.clientWidth) - 32;
  if (widest > 0 && available > 0) wrapper.style.zoom = String(Math.min(1, available / widest));
}
