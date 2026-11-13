import { test } from "node:test";
import assert from "node:assert/strict";
import WebSocket, { WebSocketServer } from "ws";
import { useWebSocketImplementation as installWebSocket } from "nostr-tools/pool";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serveRelay, type RelayEvent, type RelayStore } from "../lib/relay";
import { Termnl } from "../lib/termnl/core";
import { FileStore } from "../cli/store";
installWebSocket(WebSocket);

test("the Termnl relay delivers messages, lets only the addressee read, and refuses anything that is not a gift wrap", async () => {
  const rows: { p: string; event: RelayEvent }[] = [];
  const store: RelayStore = {
    async put(p, event) { if (!rows.some((r) => r.event.id === event.id)) rows.push({ p, event }); },
    async query(p, { since, limit }) { return rows.filter((r) => r.p === p && (!since || r.event.created_at >= since)).map((r) => r.event).slice(0, limit); },
  };
  const url = "ws://localhost:7462";
  const wss = new WebSocketServer({ port: 7462 });
  wss.on("connection", (ws) => serveRelay(ws, store, "localhost:7462"));
  const profile = (name: string) => Termnl.init(new FileStore(mkdtempSync(join(tmpdir(), `termnl-own-${name}-`))), { relays: [url], name });
  const a = profile("a"), b = profile("b");
  // A raw client that answers the relay's challenge with `sk` (or not at all) and then sends one message.
  const ask = (message: unknown[], sk?: Uint8Array) => new Promise<unknown[]>((resolve) => {
    const ws = new WebSocket(url);
    const replies: unknown[] = [];
    ws.on("message", (raw) => {
      const msg = JSON.parse(String(raw));
      if (msg[0] === "AUTH" && sk) return ws.send(JSON.stringify(["AUTH", finalizeEvent({ kind: 22242, created_at: Math.floor(Date.now() / 1000), content: "", tags: [["relay", url], ["challenge", msg[1]]] }, sk)]));
      if (msg[0] === "AUTH" || (msg[0] === "OK" && sk && !replies.length && message[0] === "REQ")) return ws.send(JSON.stringify(message));
      replies.push(msg);
      if (["EOSE", "CLOSED", "OK", "NOTICE"].includes(msg[0])) { ws.close(); resolve(replies); }
    });
    if (sk) ws.on("open", () => undefined);
  });
  try {
    // Real clients pair and exchange a message through it.
    await a.acceptInvite(b.createInvite());
    assert.equal((await b.sync()).processed, 1);
    await a.sync();
    const sent = await a.sendRequest("b", { kind: "inform", subject: "via our relay" });
    await b.sync();
    assert.ok(b.inbox().some((i) => i.id === sent.id));
    assert.ok(rows.length >= 3 && rows.every((r) => r.event.kind === 1059));

    // A stranger cannot list b's messages, signed in or not.
    const stranger = generateSecretKey(), filter = { kinds: [1059], "#p": [b.agentPub] };
    assert.equal((await ask(["REQ", "x", filter]))[0]?.[0 as never], "CLOSED");
    const snoop = await ask(["REQ", "x", filter], stranger);
    assert.deepEqual([snoop.length, (snoop[0] as string[])[0], /restricted/.test((snoop[0] as string[])[2])], [1, "CLOSED", true]);
    // Their own (empty) inbox is readable.
    assert.equal(((await ask(["REQ", "x", { kinds: [1059], "#p": [getPublicKey(stranger)] }], stranger))[0] as string[])[0], "EOSE");

    // Only gift wraps are stored.
    const note = finalizeEvent({ kind: 1, created_at: Math.floor(Date.now() / 1000), content: "hello", tags: [["p", b.agentPub]] }, stranger);
    const refused = (await ask(["EVENT", note]))[0] as unknown[];
    assert.deepEqual([refused[0], refused[2]], ["OK", false]);
    assert.ok(rows.every((r) => r.event.kind === 1059));
  } finally { a.close(); b.close(); wss.close(); for (const c of wss.clients) c.terminate(); }
});
