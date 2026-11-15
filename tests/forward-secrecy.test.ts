import WebSocket from "ws";
import { useWebSocketImplementation as installWebSocket } from "nostr-tools/pool";
installWebSocket(WebSocket);
import { after, before, mock, test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as nip44 from "nostr-tools/nip44";
import { Termnl } from "../lib/termnl/core";
import { FileStore } from "../cli/store";
import { startRelay } from "./relay";

let relay: ReturnType<typeof startRelay>;
let sam: Termnl, alex: Termnl;
const DAY = 86400;
type Inner = { sk: Uint8Array; open: (wrap: unknown, keys?: Uint8Array[]) => { env: { id: string } }; inboxSecrets: () => Uint8Array[]; forgetOldKeys: (at: number) => void };
const inner = (m: Termnl) => m as unknown as Inner;
const profile = (name: string) => Termnl.init(new FileStore(mkdtempSync(join(tmpdir(), `termnl-fs-${name}-`))), { relays: [relay.url], name });
const wrapsFor = (m: Termnl) => relay.events.filter((e) => e.tags.some((t) => t[0] === "p" && t[1] === m.agentPub)) as unknown as { content: string; pubkey: string }[];
const agentKeyOpens = (m: Termnl, wrap: { content: string; pubkey: string }) => {
  try { nip44.decrypt(wrap.content, nip44.getConversationKey(inner(m).sk, wrap.pubkey)); return true; } catch { return false; }
};

before(async () => {
  relay = startRelay(7521);
  sam = profile("sam");
  alex = profile("alex");
  await sam.acceptInvite(alex.createInvite());
  await alex.sync(); await sam.sync();
});
after(async () => {
  sam.close(); alex.close();
  await relay.stop();
});

test("once paired, messages are encrypted to the day's key, which the stolen agent key alone cannot open", async () => {
  assert.equal(alex.contacts()[0].inbox?.keys.length, 15);
  assert.equal(sam.contacts()[0].inbox?.keys.length, 15);
  const before = wrapsFor(alex).length;
  const sent = await sam.sendRequest("alex", { kind: "inform", subject: "The board pack is final" });
  const wrap = wrapsFor(alex)[before];
  assert.equal(agentKeyOpens(alex, wrap), false);
  await alex.sync();
  assert.ok(alex.inbox().some((i) => i.id === sent.id));
});

test("after the chain moves past a day, that day's messages cannot be opened even with the whole profile", async () => {
  const sent = await sam.sendRequest("alex", { kind: "inform", subject: "Read once, then gone from the relay's copy" });
  const wrap = wrapsFor(alex).at(-1)!;
  // Work on a copy of Alex's profile, as a thief would, so the real one keeps today's key for the next test.
  const dir = mkdtempSync(join(tmpdir(), "termnl-fs-later-"));
  cpSync(alex.store.dir, dir, { recursive: true });
  const later = new Termnl(new FileStore(dir));
  assert.equal(inner(later).open(wrap, inner(later).inboxSecrets()).env.id, sent.id);
  // A check a week after the day ended keeps the key; one more day and it is gone.
  const now = Math.floor(Date.now() / 1000);
  inner(later).forgetOldKeys(now + 7 * DAY);
  assert.equal(inner(later).open(wrap, inner(later).inboxSecrets()).env.id, sent.id);
  inner(later).forgetOldKeys(now + 8 * DAY);
  assert.throws(() => inner(later).open(wrap, inner(later).inboxSecrets()), /no key opens this/);
  // What it then tells contacts starts at the first day it can still open.
  const list = (later as unknown as { inboxList: () => { from: number; keys: string[] } }).inboxList();
  assert.equal(list.from, Math.floor(now / DAY) + 1);
  later.close();
});

test("a copy of the profile derives the same keys, a rotation starts a fresh chain, and switching off falls back", async () => {
  // A linked device or a restored backup holds the same chain, so it opens the same messages.
  const dir = mkdtempSync(join(tmpdir(), "termnl-fs-copy-"));
  cpSync(sam.store.dir, dir, { recursive: true });
  const copy = new Termnl(new FileStore(dir));
  const reply = await alex.sendRequest("sam", { kind: "inform", subject: "Thanks, received" });
  assert.equal(agentKeyOpens(sam, wrapsFor(sam).at(-1)!), false);
  await copy.sync();
  assert.ok(copy.inbox().some((i) => i.id === reply.id));
  copy.close();

  // Rotation: Alex learns Sam's new keys with the new certificate, and they differ from the old ones.
  const old = alex.contacts()[0].inbox!.keys[0];
  await sam.rotateAgentKey();
  await alex.sync();
  assert.notEqual(alex.contacts()[0].inbox!.keys[0], old);
  const after = await alex.sendRequest("sam", { kind: "inform", subject: "To your new key" });
  await sam.sync();
  assert.ok(sam.inbox().some((i) => i.id === after.id));

  // Off: Alex stops using daily keys, so the agent key opens what Alex sends, as before 0.4.0.
  alex.setPrefs({ forwardSecrecy: false });
  assert.equal(alex.whoami().forward_secrecy, "off");
  const plain = await alex.sendRequest("sam", { kind: "inform", subject: "Sent the old way" });
  assert.equal(agentKeyOpens(sam, wrapsFor(sam).at(-1)!), true);
  await sam.sync();
  assert.ok(sam.inbox().some((i) => i.id === plain.id));
  // Sam still holds the keys Alex gave earlier and uses them. Alex must still be able to open that.
  const late = await sam.sendRequest("alex", { kind: "inform", subject: "Sent to a key you gave me before switching off" });
  assert.equal(agentKeyOpens(alex, wrapsFor(alex).at(-1)!), false);
  await alex.sync();
  assert.ok(alex.inbox().some((i) => i.id === late.id));
  alex.setPrefs({ forwardSecrecy: true });
});

test("being offline never deletes a key, and a message that could not be opened is tried again", async () => {
  const sent = await sam.sendRequest("alex", { kind: "inform", subject: "Waiting on the relay for nine days" });
  const wrap = wrapsFor(alex).at(-1)!;
  const config = (alex as unknown as { config: { relays: string[] } }).config, real = config.relays;
  mock.timers.enable({ apis: ["Date"], now: Date.now() + 9 * DAY * 1000 });
  try {
    config.relays = ["ws://127.0.0.1:7529"]; // nothing is listening
    assert.equal((await alex.sync()).processed, 0);
    assert.equal(inner(alex).open(wrap, inner(alex).inboxSecrets()).env.id, sent.id); // the key is still there
    config.relays = real;
    await alex.sync();
    assert.ok(alex.inbox().some((i) => i.id === sent.id));
    // That complete check, nine days on, is what finally lets the old key go.
    assert.throws(() => inner(alex).open(wrap, inner(alex).inboxSecrets()), /no key opens this/);
  } finally {
    mock.timers.reset();
    // The clock has gone back nine days; let Alex's next check look back from now, not from the future.
    alex.store.write("seen.json", { ...alex.store.read("seen.json", {}), last_sync: 0 });
  }
});

test("a contact's list with a bad key or a date far ahead cannot stop or redirect delivery", async () => {
  const fresh = async () => { await alex.sendRequest("sam", { kind: "inform", subject: "Here are my keys again" }); await sam.sync(); };
  await fresh();
  const good = sam.contacts()[0].inbox!;
  // Not a point on the curve: the message goes to the agent key instead of failing.
  sam.store.write("contacts.json", sam.contacts().map((c) => ({ ...c, inbox: { from: good.from, keys: good.keys.map(() => "f".repeat(64)) } })));
  const sent = await sam.sendRequest("alex", { kind: "inform", subject: "Still arrives" });
  assert.equal(sent.unsent, undefined);
  await alex.sync();
  assert.ok(alex.inbox().some((i) => i.id === sent.id));
  // A list dated years ahead is ignored, so the next correct one is still accepted.
  sam.store.write("contacts.json", sam.contacts().map((c) => ({ ...c, inbox: good })));
  const forged = alex as unknown as { send: (to: unknown, msg: unknown, id?: string, extra?: unknown) => Promise<void> };
  await forged.send(alex.contacts()[0], { type: "receipt", body: { request_id: crypto.randomUUID(), state: "delivered" } }, undefined, { inbox: { from: good.from + 5000, keys: good.keys } });
  await sam.sync();
  assert.equal(sam.contacts()[0].inbox!.from, good.from);
});
