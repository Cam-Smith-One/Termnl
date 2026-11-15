import WebSocket from "ws";
import { useWebSocketImplementation as installWebSocket } from "nostr-tools/pool";
installWebSocket(WebSocket);
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Termnl, probeRelay, type InboxItem } from "../lib/termnl/core";
import { FileStore } from "../cli/store";
import { startRelay } from "./relay";

let a: ReturnType<typeof startRelay>, b: ReturnType<typeof startRelay>;
let sam: Termnl, alex: Termnl;
const DEAD = "ws://127.0.0.1:7513";
const contactOf = (x: Termnl, y: Termnl) => x.contacts().find((c) => c.agent === y.agentPub)!;
const pair = async () => { await sam.acceptInvite(alex.createInvite()); await alex.sync(); await sam.sync(); };

before(async () => {
  a = startRelay(7511);
  b = startRelay(7512);
  const profile = (name: string) => Termnl.init(new FileStore(mkdtempSync(join(tmpdir(), `termnl-${name}-`))), { relays: [a.url], name });
  sam = profile("sam");
  alex = profile("alex");
  await pair();
});
after(async () => {
  sam.close(); alex.close();
  await a.stop(); await b.stop();
});

test("search finds messages in both directions by subject, details or contact name", async () => {
  await sam.sendRequest("alex", { kind: "inform", subject: "Quarterly figures", details: "Revenue is in the appendix" });
  await alex.sync();
  assert.equal(alex.search("quarterly").length, 1);
  assert.equal(alex.search("APPENDIX")[0].dir, "in");
  assert.equal(sam.search("alex")[0].dir, "out");
  assert.equal(alex.search("nothing like this").length, 0);
});

test("a message with an expiry is removed from both sides, and the owner's retention removes old answered ones", async () => {
  const soon = Math.floor(Date.now() / 1000) + 2;
  const sent = await sam.sendRequest("alex", { kind: "inform", subject: "Door code 4471" }, { keepUntil: soon });
  await alex.sync();
  assert.equal(alex.inbox().find((i) => i.id === sent.id)?.keep_until, soon);
  await new Promise((r) => setTimeout(r, 2200));
  await alex.sync(); await sam.sync();
  assert.ok(!alex.inbox().some((i) => i.id === sent.id));
  assert.ok(!sam.outbox().some((o) => o.id === sent.id));
  await assert.rejects(sam.sendRequest("alex", { kind: "inform", subject: "x" }, { keepUntil: 1 }), /future/);

  // Retention: an answered message from long ago goes, an open one of the same age stays.
  const inbox = alex.inbox();
  const old = (status: InboxItem["status"]): InboxItem => ({ ...inbox[0], id: crypto.randomUUID(), received_at: 1, status });
  alex.store.write("inbox.json", [...inbox, old("declined"), old("open")]);
  alex.setPrefs({ keepDays: 30 });
  await alex.sync();
  assert.deepEqual(alex.inbox().filter((i) => i.received_at === 1).map((i) => i.status), ["open"]);
});

test("a relay is tested by writing and reading back; changing relays tells contacts and keeps reading the old ones", async () => {
  assert.equal((await probeRelay(b.url)).ok, true);
  assert.equal((await probeRelay(DEAD, 1500)).ok, false);

  assert.deepEqual(await sam.changeRelays([b.url]), { relays: [b.url], notified: 1 });
  // Alex has not heard yet, so this goes to the relay Sam left. Sam still reads it.
  const early = await alex.sendRequest("sam", { kind: "inform", subject: "Sent before I heard you moved" });
  await sam.sync();
  assert.ok(sam.inbox().some((i) => i.id === early.id));
  // Once Alex checks, Sam's record points at the new relay and delivery follows it.
  await alex.sync();
  assert.deepEqual(contactOf(alex, sam).relays, [b.url]);
  const before = b.events.length;
  await alex.sendRequest("sam", { kind: "inform", subject: "Sent to your new relay" });
  assert.equal(b.events.length, before + 1);
});

test("a failing relay is replaced by a working one a contact uses, and nothing changes when everything fails", async () => {
  await sam.changeRelays([DEAD, b.url]);
  const healed = await sam.healRelays(2);
  assert.deepEqual(healed.dropped, [DEAD]);
  assert.deepEqual(healed.added, [a.url]); // Alex's relay, tested first
  assert.deepEqual(sam.whoami().relays, [b.url, a.url]);
  assert.equal(healed.notified, 1);
  assert.deepEqual((await sam.healRelays(2)).added, []); // healthy: left alone

  // Offline looks like every relay failing. The list must survive it.
  const lonely = Termnl.init(new FileStore(mkdtempSync(join(tmpdir(), "termnl-lonely-"))), { relays: [DEAD] });
  assert.deepEqual((await lonely.healRelays()).relays, [DEAD]);
  lonely.close();
});

test("a message no relay accepts is kept and retried, delivered once, and given up on after three days", async () => {
  const point = (relays: string[]) => sam.store.write("contacts.json", sam.contacts().map((c) => ({ ...c, relays })));
  point([DEAD]);
  const queued = await sam.sendRequest("alex", { kind: "inform", subject: "Sent while their relay was down" });
  assert.equal(queued.unsent, "queued");
  await sam.sync();
  assert.equal(sam.outbox().find((o) => o.id === queued.id)?.unsent, "queued");

  point([a.url]);
  await sam.sync(); await sam.sync();
  assert.equal(sam.outbox().find((o) => o.id === queued.id)?.unsent, undefined);
  await alex.sync();
  assert.equal(alex.inbox().filter((i) => i.id === queued.id).length, 1);

  point([DEAD]);
  const stale = await sam.sendRequest("alex", { kind: "inform", subject: "Never gets there" });
  sam.store.write("outbox.json", sam.outbox().map((o) => (o.id === stale.id ? { ...o, sent_at: o.sent_at - 4 * 86400 } : o)));
  await sam.sync();
  assert.equal(sam.outbox().find((o) => o.id === stale.id)?.unsent, "failed");
  point([a.url]);
});

test("a removed contact is ignored, and a blocked one cannot pair again until unblocked", async () => {
  alex.setTeam("crew", ["sam"]);
  alex.removeContact("sam", { block: true });
  assert.equal(alex.contacts().length, 0);
  assert.equal(alex.teams().length, 0);
  const waiting = alex.inbox().length;
  await sam.sendRequest("alex", { kind: "inform", subject: "Are you there?" });
  assert.equal((await alex.sync()).processed, 0);
  assert.equal(alex.inbox().length, waiting);

  await assert.rejects(alex.acceptInvite(sam.createInvite()), /blocked/);
  await sam.acceptInvite(alex.createInvite()).catch(() => undefined);
  await alex.sync();
  assert.equal(alex.contacts().length, 0);

  alex.unblock(sam.whoami().identity);
  await sam.acceptInvite(alex.createInvite());
  await alex.sync();
  assert.equal(alex.contacts().length, 1);
});
