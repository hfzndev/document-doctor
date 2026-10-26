import "server-only";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "./config";

const dir = () => path.join(config.dataDir, "templates");

function filePath(templateId: string): string {
  if (!/^[0-9a-f-]{36}$/.test(templateId)) throw new Error("invalid template id");
  return path.join(dir(), `${templateId}.docx`);
}

export async function saveTemplateFile(templateId: string, data: Uint8Array) {
  await mkdir(dir(), { recursive: true });
  await writeFile(filePath(templateId), data, { mode: 0o600 });
}

export async function readTemplateFile(templateId: string): Promise<Buffer> {
  return readFile(filePath(templateId));
}

export async function deleteTemplateFile(templateId: string) {
  await rm(filePath(templateId), { force: true });
}
