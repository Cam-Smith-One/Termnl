process.env.TERMNL_TEST = "1"; // allows the local http file server below
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attachment, download, upload } from "../lib/termnl/files";
import { requestBody } from "../lib/termnl/protocol";
import { save } from "../cli/files";

test("attachments are stored encrypted, verified on the way back, and never written outside the downloads folder", async () => {
  const blobs = new Map<string, Buffer>();
  const server = createServer((req, res) => {
    const chunks: Uint8Array[] = [];
    req.on("data", (c) => chunks.push(c)).on("end", () => {
      if (req.method === "PUT" && req.url === "/upload" && /^Nostr /.test(req.headers.authorization ?? "")) {
        const body = Buffer.concat(chunks), sha256 = createHash("sha256").update(body as unknown as Uint8Array).digest("hex");
        blobs.set(sha256, body);
        return res.end(JSON.stringify({ sha256 }));
      }
      const blob = blobs.get((req.url ?? "").slice(1));
      blob ? res.writeHead(200, { "content-length": blob.length }).end(blob) : res.writeHead(404).end();
    });
  }).listen(7461);
  try {
    const url = "http://localhost:7461", secret = "payment terms: net 30 ".repeat(50);
    const att = await upload({ name: "../../.contract.txt", type: "text/plain", bytes: new TextEncoder().encode(secret) }, [url]);
    assert.equal(requestBody.safeParse({ kind: "inform", subject: "file", attachments: [att] }).success, true);

    // The server holds only ciphertext, addressed by its hash.
    const stored = blobs.get(att.sha256)!;
    assert.ok(!stored.includes("payment terms"));
    assert.equal(new TextDecoder().decode(await download(att)), secret);

    // Saved under a safe name inside the downloads folder, whatever the sender called it.
    const dir = mkdtempSync(join(tmpdir(), "termnl-files-"));
    const [path] = await save(dir, "abcdef12-0000", [att]);
    assert.ok(path.startsWith(join(dir, "downloads", "abcdef12-")) && !path.includes(".."));
    assert.equal(readFileSync(path, "utf8"), secret);
    writeFileSync(path, ""); // the test's own file

    // A server that swaps or corrupts the file is caught; so is a wrong key.
    stored[0] ^= 1;
    await assert.rejects(download(att), /no longer available|altered/);
    stored[0] ^= 1;
    await assert.rejects(download({ ...att, key: "0".repeat(64) }), /no longer available|altered/);

    // Pointers to private or non-https servers are refused before any request is made.
    for (const bad of ["https://127.0.0.1", "https://localhost", "http://example.com", "https://files.internal", "https://example.com/path"]) {
      assert.equal(attachment.safeParse({ ...att, servers: [bad] }).success, false, bad);
    }
  } finally { server.close(); }
});
