import { chmodSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { basename, join, sep } from "node:path";
import { download, upload, type Attachment } from "../lib/termnl/files";

/** Encrypt and upload local files, returning the pointers that go inside the message. */
export const attach = (paths: string[]): Promise<Attachment[]> =>
  Promise.all(paths.map((path) => upload({ name: basename(path), bytes: new Uint8Array(readFileSync(path)) })));

/**
 * Check the paths an agent wants to attach. The agent may only send regular files from folders the owner
 * chose (the mandate's agentFileDirs, or the profile's "share" folder when none are set), and never the
 * profile's own files, which include its private keys. Links are resolved first, so a link cannot reach outside.
 */
export function agentPaths(paths: string[], profileDir: string, allowed: string[]): string[] {
  const share = join(profileDir, "share");
  mkdirSync(share, { recursive: true, mode: 0o700 });
  const real = (p: string) => { try { return realpathSync(p); } catch { return undefined; } };
  const inside = (file: string, dir: string | undefined) => !!dir && file.startsWith(dir + sep);
  const roots = (allowed.length ? allowed : [share]).map(real);
  const profile = real(profileDir), shared = real(share);
  return paths.map((path) => {
    const file = real(path);
    const ok = !!file && statSync(file).isFile() && roots.some((r) => inside(file, r)) && (!inside(file, profile) || inside(file, shared));
    if (!ok) throw new Error(`The agent can only attach files from ${allowed.length ? "the folders in the mandate's agentFileDirs" : share}. The owner can send any file with \`termnl send --file\`.`);
    return file!;
  });
}

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
