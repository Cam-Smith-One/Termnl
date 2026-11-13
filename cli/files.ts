import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { download, upload, type Attachment } from "../lib/termnl/files";

/** Encrypt and upload local files, returning the pointers that go inside the message. */
export const attach = (paths: string[]): Promise<Attachment[]> =>
  Promise.all(paths.map((path) => upload({ name: basename(path), bytes: new Uint8Array(readFileSync(path)) })));

/** Download, verify and decrypt attachments into the profile's downloads folder. Files are saved, never opened or run. */
export async function save(dir: string, requestId: string, attachments: Attachment[] = []): Promise<string[]> {
  if (!attachments.length) throw new Error("That request has no attachments");
  const folder = join(dir, "downloads");
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  const paths: string[] = [];
  for (const att of attachments) {
    // The name is the sender's: keep it inside the folder and never let it become a hidden file.
    const path = join(folder, `${requestId.slice(0, 8)}-${basename(att.name).replace(/\.{2,}/g, "_").replace(/^\./, "_")}`);
    writeFileSync(path, await download(att), { mode: 0o600 });
    chmodSync(path, 0o600);
    paths.push(path);
  }
  return paths;
}
