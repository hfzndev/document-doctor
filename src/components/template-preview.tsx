"use client";
import { useEffect, useState } from "react";
import { DocxPreview } from "./docx-preview";

export function TemplatePreview({ templateId }: { templateId: string }) {
  const [data, setData] = useState<Uint8Array | null>(null);
  useEffect(() => {
    fetch(`/api/templates/${templateId}/file`)
      .then((r) => r.arrayBuffer())
      .then((b) => setData(new Uint8Array(b)));
  }, [templateId]);
  return (
    <section className="flex min-h-[70vh] min-w-0 flex-1 flex-col bg-slate-200/70 lg:min-h-0">
      <DocxPreview data={data} className="min-h-0 flex-1 overflow-auto" />
    </section>
  );
}
