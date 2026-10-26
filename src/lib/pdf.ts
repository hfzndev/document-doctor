// DOCX -> PDF with headless LibreOffice. Conversions run one at a time (soffice is heavy,
// and each run gets its own throwaway profile so a crashed run can't lock the next).
import "server-only";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { config } from "./config";

let queue: Promise<unknown> = Promise.resolve();

export function docxToPdf(docx: Uint8Array): Promise<Buffer> {
  const run = queue.then(() => convert(docx));
  queue = run.catch(() => undefined);
  return run;
}

async function convert(docx: Uint8Array): Promise<Buffer> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "dd-pdf-"));
  try {
    const input = path.join(dir, "document.docx");
    await writeFile(input, docx);
    await new Promise<void>((resolve, reject) => {
      execFile(
        config.sofficePath,
        [
          `-env:UserInstallation=${pathToFileURL(path.join(dir, "profile")).href}`,
          "--headless",
          "--norestore",
          "--nolockcheck",
          "--convert-to",
          "pdf:writer_pdf_Export",
          "--outdir",
          dir,
          input,
        ],
        { timeout: 90_000, env: { ...process.env, HOME: dir } },
        (err, _stdout, stderr) => {
          if (err) reject(new Error(`LibreOffice failed: ${err.message} ${stderr}`.trim()));
          else resolve();
        },
      );
    });
    return await readFile(path.join(dir, "document.pdf"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
