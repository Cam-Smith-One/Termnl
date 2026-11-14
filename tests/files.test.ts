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
import { agentPaths, save } from "../cli/files";
import { mkdirSync, symlinkSync } from "node:fs";

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

    // A file server may not bounce the request somewhere else: the redirect is refused, never followed.
    let followed = false;
    const target = createServer((_, res) => { followed = true; res.end("x"); }).listen(7493);
    const bouncer = createServer((_, res) => res.writeHead(302, { location: "http://127.0.0.1:7493/admin" }).end()).listen(7492);
    try {
      await assert.rejects(download({ ...att, servers: ["http://localhost:7492"] }), /no longer available|altered/);
      assert.equal(followed, false);
    } finally { target.close(); bouncer.close(); }

    // Pointers to private or non-https servers are refused before any request is made.
    for (const bad of ["https://127.0.0.1", "https://localhost", "http://example.com", "https://files.internal", "https://example.com/path"]) {
      assert.equal(attachment.safeParse({ ...att, servers: [bad] }).success, false, bad);
    }
  } finally { server.close(); }
});

test("the agent can attach only from folders the owner chose, never the profile's keys", () => {
  const profile = mkdtempSync(join(tmpdir(), "termnl-agentfiles-")), elsewhere = mkdtempSync(join(tmpdir(), "termnl-elsewhere-"));
  writeFileSync(join(profile, "identity.key"), "secret"); writeFileSync(join(elsewhere, "notes.txt"), "private");
  mkdirSync(join(profile, "share")); writeFileSync(join(profile, "share", "ok.txt"), "fine");
  symlinkSync(join(profile, "identity.key"), join(profile, "share", "link.txt"));

  assert.equal(agentPaths([join(profile, "share", "ok.txt")], profile, []).length, 1);
  for (const bad of [join(profile, "identity.key"), join(elsewhere, "notes.txt"), join(profile, "share", "link.txt"), join(profile, "share", "..", "identity.key"), join(profile, "share"), join(profile, "share", "missing.txt")]) {
    assert.throws(() => agentPaths([bad], profile, []), /can only attach/, bad);
  }
  // Even if the owner lists the profile folder itself, its own files stay out of reach.
  assert.throws(() => agentPaths([join(profile, "identity.key")], profile, [profile]), /can only attach/);
  assert.equal(agentPaths([join(elsewhere, "notes.txt")], profile, [elsewhere]).length, 1);
});
