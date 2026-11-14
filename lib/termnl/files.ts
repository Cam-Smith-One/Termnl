import { z } from "zod";
import { finalizeEvent, generateSecretKey } from "nostr-tools/pure";
import { bytesToHex, hexToBytes } from "nostr-tools/utils";

/**
 * Encrypted attachments over Blossom (content-addressed file servers).
 * The file is encrypted here with a fresh AES-256-GCM key; servers only ever store ciphertext.
 * The pointer below (hash, key, servers) travels inside the encrypted Termnl message.
 */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
// ponytail: fixed public servers; make this a per-profile setting when someone needs their own.
// Most public Blossom servers only accept recognised media types and refuse encrypted data; this one takes any file.
export const DEFAULT_BLOSSOM = ["https://nostr.download"];

const local = (host: string) => ["localhost", "127.0.0.1", "[::1]"].includes(host);
const serverUrl = z.string().max(200).refine((value) => {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/") return false;
    // ponytail: literal private addresses are refused; a hostname that resolves to one is not. Downloads only happen when asked for.
    if (url.protocol === "https:") return !local(url.hostname) && !/^\[|^\d+\.\d+\.\d+\.\d+$|\.(local|internal)$/.test(url.hostname);
    return url.protocol === "http:" && local(url.hostname) && process.env.TERMNL_TEST === "1";
  } catch { return false; }
}, "File servers must be public https:// addresses");

export const attachment = z.object({
  /** Chosen by the sender: display only. Sanitised again before anything is written to disk. */
  name: z.string().min(1).max(120).regex(/^[^\p{Cc}/\\]*$/u, "no path or control characters"),
  type: z.string().max(100).regex(/^[\w.+-]+\/[\w.+-]+$/),
  size: z.number().int().positive().max(MAX_FILE_BYTES),
  /** SHA-256 of the ciphertext, which is also its address on every server. */
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  key: z.string().regex(/^[0-9a-f]{64}$/),
  nonce: z.string().regex(/^[0-9a-f]{24}$/),
  servers: z.array(serverUrl).min(1).max(4),
}).strict();
export type Attachment = z.infer<typeof attachment>;

const subtle = globalThis.crypto.subtle;
const sha256 = async (bytes: Uint8Array) => bytesToHex(new Uint8Array(await subtle.digest("SHA-256", bytes as BufferSource)));
const aes = (key: Uint8Array, use: KeyUsage) => subtle.importKey("raw", key as BufferSource, "AES-GCM", false, [use]);
const base64url = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Encrypt a file and store the ciphertext on the given servers. Succeeds if at least one server keeps it. */
export async function upload(file: { name: string; type?: string; bytes: Uint8Array }, servers = DEFAULT_BLOSSOM): Promise<Attachment> {
  if (!file.bytes.length || file.bytes.length > MAX_FILE_BYTES) throw new Error(`Attachments must be between 1 byte and ${MAX_FILE_BYTES / 1024 / 1024} MB`);
  const key = globalThis.crypto.getRandomValues(new Uint8Array(32)), nonce = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv: nonce as BufferSource }, await aes(key, "encrypt"), file.bytes as BufferSource));
  const hash = await sha256(sealed);
  // A throwaway key signs the upload, so the server cannot link the file to either party's identity.
  const now = Math.floor(Date.now() / 1000);
  const auth = finalizeEvent({ kind: 24242, created_at: now, content: "Upload encrypted attachment", tags: [["t", "upload"], ["x", hash], ["expiration", String(now + 300)]] }, generateSecretKey());
  const results = await Promise.all(servers.map(async (server) => {
    try {
      const response = await fetch(`${server}/upload`, {
        redirect: "error", method: "PUT", body: sealed as BodyInit, signal: AbortSignal.timeout(60000),
        headers: { Authorization: `Nostr ${base64url(JSON.stringify(auth))}`, "Content-Type": "application/octet-stream", "X-SHA-256": hash },
      });
      return response.ok && (await response.json()).sha256 === hash ? server : null;
    } catch { return null; }
  }));
  const stored = results.filter((server): server is string => !!server);
  if (!stored.length) throw new Error("No file server accepted the attachment");
  return attachment.parse({
    name: file.name.replace(/[\p{Cc}/\\]/gu, "_").slice(0, 120), type: /^[\w.+-]+\/[\w.+-]+$/.test(file.type ?? "") ? file.type : "application/octet-stream",
    size: file.bytes.length, sha256: hash, key: bytesToHex(key), nonce: bytesToHex(nonce), servers: stored,
  });
}

/** Fetch an attachment from whichever server still has it, check it is the exact file that was sent, and decrypt it. */
export async function download(input: Attachment): Promise<Uint8Array> {
  const att = attachment.parse(input);
  for (const server of att.servers) {
    try {
      // The server address was checked; a redirect would send the request somewhere that was not.
      const response = await fetch(`${server}/${att.sha256}`, { signal: AbortSignal.timeout(60000), redirect: "error" });
      // GCM adds a 16-byte tag; anything else is not our file, so do not even read it.
      if (!response.ok || Number(response.headers.get("content-length") ?? att.size + 16) !== att.size + 16) continue;
      const sealed = new Uint8Array(await response.arrayBuffer());
      if (sealed.length !== att.size + 16 || (await sha256(sealed)) !== att.sha256) continue;
      return new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: hexToBytes(att.nonce) as BufferSource }, await aes(hexToBytes(att.key), "decrypt"), sealed as BufferSource));
    } catch { /* try the next server */ }
  }
  throw new Error("The attachment is no longer available from any of its file servers, or it was altered");
}
