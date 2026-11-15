import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from "nostr-tools/pure";
import { SimplePool } from "nostr-tools/pool";
import { bytesToHex, hexToBytes, normalizeURL } from "nostr-tools/utils";
import * as nip44 from "nostr-tools/nip44";
import { createRumor, createSeal, wrapEvent } from "nostr-tools/nip59";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { decode as nipDecode, npubEncode } from "nostr-tools/nip19";
import {
  DEFAULT_MANDATE,
  KIND,
  MAX_WRAP_BYTES,
  canonical,
  decodeInvite,
  encodeInvite,
  envelope,
  mandate as mandateSchema,
  requestBody,
  sha256hex,
  withinLimit,
  autoAcceptable,
  relayList,
  CANDIDATE_RELAYS,
  type Envelope,
  type Mandate,
  type RequestBody,
  type GroupInfo,
  type InboxKeys,
  MAX_RECIPIENTS,
  recipientTag,
  type SignedEvent,
} from "./protocol";
import type { Store } from "./store";

const now = () => Math.floor(Date.now() / 1000);
const toHex = bytesToHex;
const fromHex = hexToBytes;
const randomUUID = () => globalThis.crypto.randomUUID();
const DAY = 86400;

// ---------- forward secrecy: daily inbox keys ----------
// Each profile holds a secret "chain" that moves forward one step per UTC day and cannot be run backwards.
// Every day has its own decryption key derived from the chain; contacts are told the public halves two weeks
// ahead and encrypt to today's. Once the chain has moved past a day, that day's key no longer exists anywhere,
// so messages from it cannot be decrypted even by someone who later steals the whole profile.
// This is the same construction as a Signal chain key: next = HMAC(chain, 2), key = HMAC(chain, 1).
const today = () => Math.floor(now() / DAY);
/** How many days of keys contacts are given in advance, and how long a day's key is kept after the day ends. */
const KEYS_AHEAD = 14, KEEP_KEY_DAYS = 7;
interface Chain {
  epoch: number;
  chain: string;
}
const step = (chain: Uint8Array) => hmac(sha256, chain, Uint8Array.of(2));
function dayKey(chain: Uint8Array): Uint8Array {
  // A hash is a valid private key except with negligible probability; the counter covers that case.
  for (let i = 0; ; i++) {
    const sk = hmac(sha256, chain, Uint8Array.of(1, i));
    try { getPublicKey(sk); return sk; } catch { /* try the next counter */ }
  }
}
/** The private keys a chain yields for days first..last, oldest first. */
function dayKeys(c: Chain, first: number, last: number): { day: number; sk: Uint8Array }[] {
  const out: { day: number; sk: Uint8Array }[] = [];
  let chain = fromHex(c.chain);
  for (let day = c.epoch; day <= last; day++, chain = step(chain)) if (day >= first) out.push({ day, sk: dayKey(chain) });
  return out;
}

export interface Contact {
  identity: string;
  agent: string;
  cert: SignedEvent;
  relays: string[];
  /** Self-declared by the peer: display only, never trusted. */
  name?: string;
  paired_at: number;
  /** We accepted their invite but they have not yet proved they hold the key. Nothing is sent until they do. */
  pending?: boolean;
  /** Their daily inbox keys, as last told to us by their own agent key. */
  inbox?: InboxKeys;
}

export interface InboxItem {
  id: string;
  from: string;
  body: RequestBody;
  request_hash: string;
  received_at: number;
  authority: "auto" | "needs_owner" | "owner_approved";
  status: "open" | "accepted" | "declined" | "countered";
  /** The sender says these people also received it, as recipient tags. A claim by the sender, not verified. */
  group?: GroupInfo;
  /** The earlier message with this contact that it answers. */
  re?: string;
  /** The latest receipt we sent back for it. */
  receipted?: "delivered" | "shown";
  /** The sender asked for it to be removed at this time. */
  keep_until?: number;
}

export interface OutboxItem {
  id: string;
  to: string;
  body: RequestBody;
  request_hash: string;
  sent_at: number;
  status: "open" | "declined" | "countered" | "committed";
  note?: string;
  /** Set when this was one copy of a message to several contacts; shown says whether they can see each other. */
  group?: GroupInfo & { shown: boolean };
  re?: string;
  /** When their side last told us something about it: a receipt or an answer. */
  updated_at?: number;
  receipt?: { delivered_at?: number; shown_at?: number; note?: string };
  keep_until?: number;
  /** No relay took it yet: "queued" is retried at every check, "failed" was given up on after three days. */
  unsent?: "queued" | "failed";
}

export interface Prefs {
  inboxCheckMinutes: number;
  /** False stops this profile sending receipts. */
  receipts?: boolean;
  /** A short status sent with delivery receipts, such as "Heads down until 2 pm". */
  status?: { text: string; until?: number };
  lastCatchUp?: number;
  /** Answered messages older than this many days are removed from this device. Signed agreements are kept. */
  keepDays?: number;
  /** The owner lets Termnl replace a relay that stops working, once a day at most, and tell contacts. */
  autoRelays?: boolean;
  lastRelayCheck?: number;
  /** This profile also runs on another device: tell the others what this one sends, answers and pairs. */
  linked?: boolean;
  /** False switches daily inbox keys off: this profile neither offers them nor uses a contact's. */
  forwardSecrecy?: boolean;
}

/** A message queued for later. Always sent as the agent, so the mandate is checked again when it falls due. */
export interface Scheduled {
  id: string;
  to: string[];
  body: RequestBody;
  at: number;
  re?: string;
  /** Send only if this earlier request of ours is still unanswered: a reminder. */
  unless_answered?: string;
  showRecipients?: boolean;
  team?: string;
  tries?: number;
}

/** A local name for a set of contacts. Nothing about a team is shared except its name on messages sent to it. */
export interface Team {
  name: string;
  members: string[];
}

export interface CommitmentRecord {
  request_id: string;
  with: string;
  role: "requester" | "responder";
  commitment: SignedEvent;
  cosign?: SignedEvent;
  /** Each side's agent certificate when it signed, so the agreement stays provable after key rotation. */
  certs?: { mine: SignedEvent; theirs: SignedEvent };
}

interface Config {
  identity: string;
  relays: string[];
  name?: string;
  /** Relays we have stopped using but still read, so messages already on their way there are not lost. */
  retired?: { url: string; until: number }[];
}

export interface RelayProbe {
  url: string;
  ok: boolean;
  ms?: number;
  error?: string;
}

/**
 * Test a relay the way a stranger's message would use it: publish a throwaway gift wrap and read it back.
 * The keys are made for this one test, so the relay learns nothing about the profile except the client's IP.
 */
export async function probeRelay(url: string, maxWait = 6000): Promise<RelayProbe> {
  const pool = new SimplePool(), sk = generateSecretKey(), started = Date.now();
  const onauth = async (event: Parameters<typeof finalizeEvent>[0]) => finalizeEvent(event, sk);
  try {
    const wrap = wrapEvent({ kind: KIND.ENVELOPE, content: "probe", tags: [], created_at: now() }, sk, getPublicKey(sk));
    await Promise.all(pool.publish([url], wrap, { onauth, maxWait }));
    const options = { maxWait, onauth };
    const back = await pool.querySync([url], { kinds: [KIND.GIFT_WRAP], "#p": [getPublicKey(sk)], limit: 5 }, options);
    if (!back.some((e) => e.id === wrap.id)) return { url, ok: false, error: "accepted the message but did not return it" };
    return { url, ok: true, ms: Date.now() - started };
  } catch (e) {
    return { url, ok: false, error: String((e as Error)?.message ?? e).slice(0, 120) };
  } finally {
    pool.close([url]);
    pool.destroy?.();
  }
}
interface AgentKey {
  sk: string;
  cert: SignedEvent;
}
interface InviteRecord {
  code: string;
  expires: number;
  used: boolean;
}
interface Seen {
  wraps: string[];
  envelopes: string[];
  last_sync: number;
}

export class MandateError extends Error {}
/** Every one of the contact's relays refused or was unreachable. */
class NoRelayError extends Error {}
/** None of the keys held opens a gift wrap. It is tried again later, in case the key was only briefly unavailable. */
class NoKeyError extends Error {}
const RETRY_DAYS = 3;

function tag(ev: { tags: string[][] }, name: string): string | undefined {
  return ev.tags.find((t) => t[0] === name)?.[1];
}

/** An agent certificate is valid if the identity key signed it for this agent key and it has not expired. */
export function certValid(cert: SignedEvent, identity: string, agent: string, at = now()): boolean {
  if (cert.kind !== KIND.AGENT_CERT || cert.pubkey !== identity) return false;
  if (tag(cert, "p") !== agent) return false;
  const exp = Number(tag(cert, "expiration"));
  if (!Number.isFinite(exp) || exp <= at) return false;
  return verifyEvent(cert);
}

export class Termnl {
  readonly store: Store;
  private pool = new SimplePool();
  private config: Config;
  /** Most wraps fetched per relay per sync, so a flood aimed at this key cannot make a check arbitrarily slow. */
  syncLimit = 500;
  private agent: AgentKey;
  private sk: Uint8Array;

  constructor(store: Store) {
    this.store = store;
    if (!store.has("config.json") || !store.has("agent.json")) {
      throw new Error(`No termnl profile in ${store.dir}. The owner must run: termnl init`);
    }
    this.config = store.read<Config>("config.json", null as never);
    this.agent = store.read<AgentKey>("agent.json", null as never);
    this.sk = fromHex(this.agent.sk);
  }

  // ---------- owner-only setup (never called from the MCP server) ----------

  /** Create an identity key, a first agent key and a default mandate. */
  static init(store: Store, opts: { relays: string[]; name?: string; certDays?: number }): Termnl {
    if (store.has("config.json")) throw new Error(`Profile already exists in ${store.dir}`);
    const identitySk = generateSecretKey();
    store.write("identity.key", { sk: toHex(identitySk) }, true);
    store.write("config.json", { identity: getPublicKey(identitySk), relays: relayList.parse(opts.relays), name: opts.name?.slice(0,80) });
    store.write("mandate.json", DEFAULT_MANDATE);
    Termnl.issueAgentKey(store, opts.certDays ?? 30);
    identitySk.fill(0);
    return new Termnl(store);
  }

  private static issueAgentKey(store: Store, days: number): AgentKey {
    if (!Number.isFinite(days) || days < 1 || days > 90) throw new Error("Certificate lifetime must be 1–90 days");
    if (!store.has("identity.key")) {
      throw new Error("identity.key is not on this machine. Restore it to rotate the agent key.");
    }
    const identitySk = fromHex(store.read<{ sk: string }>("identity.key", null as never).sk);
    const agentSk = generateSecretKey();
    const previous = store.read<AgentKey | null>("agent.json", null);
    const issuedAt = Math.max(now(), (previous?.cert.created_at ?? 0) + 1);
    const cert = finalizeEvent(
      {
        kind: KIND.AGENT_CERT,
        created_at: issuedAt,
        tags: [["p", getPublicKey(agentSk)], ["expiration", String(issuedAt + days * DAY)]],
        content: "",
      },
      identitySk,
    ) as SignedEvent;
    const key = { sk: toHex(agentSk), cert };
    store.write("agent.json", key, true);
    identitySk.fill(0);
    agentSk.fill(0);
    return key;
  }

  /** Replace the agent key. Contacts stop accepting the old key once they process the update. */
  async rotateAgentKey(days = 30): Promise<{ notified: number }> {
    this.agent = Termnl.issueAgentKey(this.store, days);
    this.sk = fromHex(this.agent.sk);
    // A rotation may follow a theft, so the daily-key chain starts again from fresh randomness: chain() sees that
    // the stored one belongs to the old key and replaces it. Nothing is lost by that, because messages addressed
    // to the old agent key are no longer fetched at all.
    let notified = 0;
    for (const c of this.contacts()) {
      try {
        await this.send(c, { type: "cert_update", body: { cert: this.agent.cert } });
        notified++;
      } catch {
        /* contact unreachable; they will reject us until they receive an update */
      }
    }
    return { notified };
  }

  createInvite(ttlMinutes = 60): string {
    if (!Number.isFinite(ttlMinutes) || ttlMinutes < 1 || ttlMinutes > 1440) throw new Error("Invite lifetime must be 1–1440 minutes");
    const code = toHex(globalThis.crypto.getRandomValues(new Uint8Array(16)));
    const invites = this.store.read<InviteRecord[]>("invites.json", []);
    invites.push({ code, expires: now() + ttlMinutes * 60, used: false });
    this.store.write("invites.json", invites);
    return encodeInvite({ ...this.pairingBody(), agent: this.agentPub, code });
  }

  async acceptInvite(text: string): Promise<Contact> {
    const inv = decodeInvite(text);
    if (inv.identity === this.config.identity) throw new Error("That is your own invite");
    if (!certValid(inv.cert, inv.identity, inv.agent)) throw new Error("Invite has an invalid or expired certificate");
    if (this.blocked().includes(inv.identity)) throw new Error("You have blocked this person. Unblock them first with: termnl unblock <npub>");
    // An invite is only a claim: anyone can build one from a certificate they have seen.
    // The contact stays pending until its agent key actually writes to us.
    // For someone already confirmed, nothing in the invite is believed: their record changes only when
    // their own agent key answers (see onKnockAccept). Otherwise a third party holding their certificate
    // could quietly redirect our messages to them.
    const known = this.contacts().find((c) => c.identity === inv.identity && c.agent === inv.agent && !c.pending);
    const contact = known ?? this.saveContact({
      identity: inv.identity,
      agent: inv.agent,
      cert: inv.cert,
      relays: inv.relays,
      name: inv.name,
      paired_at: now(),
      pending: true,
    });
    // The knock itself goes where the invite says, so a contact who really has moved relays still receives it.
    await this.send({ ...contact, relays: inv.relays }, { type: "knock", body: { ...this.pairingBody(), code: inv.code } });
    return contact;
  }

  /** Owner approves an inbound request that is outside the mandate. */
  approve(requestId: string): InboxItem {
    const inbox = this.inbox();
    const item = inbox.find((i) => i.id === requestId);
    if (!item) throw new Error(`No inbound request ${requestId}`);
    if (item.status !== "open") throw new Error("Only open requests can be approved");
    item.authority = "owner_approved";
    this.store.write("inbox.json", inbox);
    this.log("owner", item.from, "approve", requestId);
    return item;
  }

  // ---------- read-only views ----------

  get agentPub(): string {
    return getPublicKey(this.sk);
  }

  whoami() {
    const exp = Number(tag(this.agent.cert, "expiration"));
    return {
      name: this.config.name,
      identity: npubEncode(this.config.identity),
      agent_key: npubEncode(this.agentPub),
      agent_key_expires: new Date(exp * 1000).toISOString(),
      relays: this.config.relays,
      forward_secrecy: this.inboxList() ? "on: messages to you use a key that is deleted about a week later" : "off",
      mandate: this.mandate(),
    };
  }

  mandate(): Mandate {
    return mandateSchema.parse(this.store.read("mandate.json", DEFAULT_MANDATE));
  }
  setMandate(value: unknown): Mandate {
    const parsed = mandateSchema.parse(value);
    this.store.write("mandate.json", parsed);
    return parsed;
  }
  setRelays(value: string[]): string[] {
    const relays = relayList.parse(value);
    this.pool.close(this.readRelays());
    // Keep reading the ones we leave for 30 days: contacts who have not heard yet still deliver there.
    const left = this.config.relays.filter((r) => !relays.includes(r)).map((url) => ({ url, until: now() + 30 * DAY }));
    this.config.retired = [...left, ...(this.config.retired ?? [])].filter((r) => r.until > now() && !relays.includes(r.url)).slice(0, 8);
    this.config.relays = relays;
    this.store.write("config.json", this.config);
    return relays;
  }
  /** Where to look for messages: our relays, plus the ones we recently left. */
  private readRelays(): string[] {
    return [...this.config.relays, ...(this.config.retired ?? []).filter((r) => r.until > now()).map((r) => r.url)];
  }
  /** Change relays and tell every confirmed contact, signed by this agent key, so they deliver to the new ones. */
  async changeRelays(value: string[]): Promise<{ relays: string[]; notified: number }> {
    await this.mirror("relays", relayList.parse(value)); // sent to the old relays, where the other devices still listen
    const relays = this.setRelays(value);
    let notified = 0;
    for (const c of this.contacts().filter((x) => !x.pending)) {
      try {
        // A contact's relay list changes on exactly this message from our own key; released clients already honour it.
        await this.send(c, { type: "knock_accept", body: this.pairingBody() });
        notified++;
      } catch { /* unreachable for now: they keep delivering to the relays we still read */ }
    }
    return { relays, notified };
  }
  checkRelays(): Promise<RelayProbe[]> {
    return Promise.all(this.config.relays.map((r) => probeRelay(r)));
  }
  /** Working relays we are not using yet, fastest first: the built-in list plus the ones our contacts use. */
  async findRelays(): Promise<RelayProbe[]> {
    // Tests never touch the public network.
    const builtIn = process.env.TERMNL_TEST === "1" ? [] : CANDIDATE_RELAYS;
    const pool = [...new Set([...builtIn, ...this.contacts().flatMap((c) => c.relays)])].filter((r) => !this.config.relays.includes(r));
    return (await Promise.all(pool.map((r) => probeRelay(r)))).filter((p) => p.ok).sort((a, b) => (a.ms ?? 0) - (b.ms ?? 0));
  }
  /**
   * Replace relays that fail the test with working ones, up to `want`, and tell contacts.
   * ponytail: one failed test drops a relay. It is still read for 30 days, so a relay having a bad hour costs
   * nothing but a notice to contacts; add a strike count if relays flap.
   */
  async healRelays(want = 3): Promise<{ relays: string[]; added: string[]; dropped: string[]; notified: number }> {
    const health = await this.checkRelays();
    const good = health.filter((h) => h.ok).map((h) => h.url), dropped = health.filter((h) => !h.ok).map((h) => h.url);
    const same = { relays: this.config.relays, added: [], dropped: [], notified: 0 };
    if (!dropped.length && good.length >= Math.min(want, 2)) return same;
    const added = (await this.findRelays()).slice(0, Math.max(0, want - good.length)).map((p) => p.url);
    // Nothing answered at all: far more likely this machine is offline than every relay being gone.
    if (!added.length && (!good.length || !dropped.length)) return same;
    return { ...(await this.changeRelays([...good, ...added])), added, dropped };
  }
  blocked(): string[] {
    return this.store.read<string[]>("blocked.json", []);
  }
  /** Owner only. Their messages are ignored from now on; nothing is sent to tell them. History is kept. */
  removeContact(ref: string, opts: { block?: boolean; quiet?: boolean } = {}): Contact {
    const c = this.resolveContact(ref);
    this.store.write("contacts.json", this.contacts().filter((x) => x.identity !== c.identity));
    if (this.teams().length) this.store.write("teams.json", this.teams().map((t) => ({ ...t, members: t.members.filter((m) => m !== c.identity) })).filter((t) => t.members.length));
    if (this.scheduled().length) this.store.write("scheduled.json", this.scheduled().map((s) => ({ ...s, to: s.to.filter((i) => i !== c.identity) })).filter((s) => s.to.length));
    // Blocking also refuses any later invite from, or to, the same identity.
    if (opts.block) this.store.write("blocked.json", [...new Set([...this.blocked(), c.identity])]);
    this.log("owner", c.agent, opts.block ? "block" : "remove", c.identity);
    if (!opts.quiet) this.later(this.mirror("removed", { identity: c.identity, block: !!opts.block }));
    return c;
  }
  unblock(ref: string): boolean {
    const id = ref.startsWith("npub") ? String(nipDecode(ref).data) : ref;
    this.store.write("blocked.json", this.blocked().filter((b) => b !== id));
    return true;
  }
  /**
   * A short code both people see for their pairing. Read it to each other over a call: if it matches,
   * the invite was not swapped on the way.
   */
  safetyCode(ref: string): string {
    const pair = [this.config.identity, this.resolveContact(ref).identity].sort().join(":");
    const n = parseInt(sha256hex(`termnl-safety:${pair}`).slice(0, 13), 16) % 1e12;
    return String(n).padStart(12, "0").replace(/(\d{4})(?=\d)/g, "$1 ");
  }

  // ---------- forward secrecy ----------

  /** Another process has rotated the agent key since this one started. It must not write key material. */
  private stale(): boolean {
    return this.store.read<AgentKey>("agent.json", this.agent).sk !== this.agent.sk;
  }
  /**
   * This profile's chain. The file names the agent key it belongs to and is encrypted to that key.
   * A chain is only ever created when there is none for the current key; one that cannot be read is left alone.
   */
  private chain(): Chain | undefined {
    const read = (): { chain?: Chain; mine: boolean } => {
      const saved = this.store.read<{ for: string; v: string } | null>("inboxkeys.json", null);
      if (saved?.for !== this.agentPub) return { mine: false };
      try { return { mine: true, chain: JSON.parse(nip44.decrypt(saved.v, nip44.getConversationKey(this.sk, this.agentPub))) as Chain }; } catch { return { mine: true }; }
    };
    const have = read();
    if (have.mine) return have.chain;
    // None yet for this key. Do not start one while switched off, or from a process holding a retired key.
    if (this.prefs().forwardSecrecy === false || this.stale()) return undefined;
    // Two processes must not each start a chain, or one would advertise keys the other overwrites.
    const release = this.store.exclusive?.("inboxkeys");
    if (this.store.exclusive && !release) return undefined; // nothing has been advertised yet, so nothing can be lost
    try {
      const again = read();
      if (again.mine) return again.chain;
      const fresh = { epoch: today(), chain: toHex(generateSecretKey()) };
      this.saveChain(fresh);
      return fresh;
    } finally {
      release?.();
    }
  }
  private saveChain(chain: Chain): void {
    // ponytail: a rotation in another process between this check and the write is not excluded; the window is one file read.
    if (this.stale()) return;
    this.store.write("inboxkeys.json", { for: this.agentPub, v: nip44.encrypt(JSON.stringify(chain), nip44.getConversationKey(this.sk, this.agentPub)) });
  }
  /** The public keys contacts should encrypt to, from today for two weeks. Undefined when switched off. */
  private inboxList(): InboxKeys | undefined {
    const c = this.prefs().forwardSecrecy === false ? undefined : this.chain();
    const keys = c ? dayKeys(c, today(), today() + KEYS_AHEAD) : [];
    return keys.length ? { from: keys[0].day, keys: keys.map((k) => getPublicKey(k.sk)) } : undefined;
  }
  /**
   * Every daily key still derivable, nearest to today first. Used even when the feature is switched off, because
   * contacts keep encrypting to the keys they were given until their list runs out.
   */
  private inboxSecrets(): Uint8Array[] {
    const c = this.chain();
    return c ? dayKeys(c, 0, today() + KEYS_AHEAD).sort((a, b) => Math.abs(a.day - today()) - Math.abs(b.day - today())).slice(0, 120).map((k) => k.sk) : [];
  }
  /**
   * Forget the keys of days that ended more than a week before a complete check began. Being offline never
   * deletes anything: the chain only moves when this device has just heard back from every one of its relays.
   */
  private forgetOldKeys(checkedAt: number): void {
    const c = this.chain();
    const floor = Math.floor(checkedAt / DAY) - KEEP_KEY_DAYS;
    if (!c || c.epoch >= floor) return;
    let chain = fromHex(c.chain);
    for (let day = c.epoch; day < floor; day++) chain = step(chain);
    this.saveChain({ epoch: floor, chain: toHex(chain) });
  }
  /** A gift wrap encrypted to a contact's key for today. The recipient tag stays their agent key, so relays see nothing new. */
  private wrapFor(event: { kind: number; content: string; tags: string[][]; created_at: number }, dayPub: string, agent: string): SignedEvent {
    const seal = createSeal(createRumor(event, this.sk), this.sk, dayPub);
    const once = generateSecretKey();
    return finalizeEvent({
      kind: KIND.GIFT_WRAP,
      content: nip44.encrypt(JSON.stringify(seal), nip44.getConversationKey(once, dayPub)),
      created_at: now() - Math.floor(Math.random() * 2 * DAY), // as NIP-59 does, to hide when it was sent
      tags: [["p", agent]],
    }, once) as SignedEvent;
  }

  // ---------- one identity on several devices ----------

  private background = new Set<Promise<void>>();
  private later(work: Promise<void>): void {
    this.background.add(work);
    void work.finally(() => this.background.delete(work));
  }
  /** Wait for notes to the owner's other devices to go out. Call before closing a short-lived process. */
  async idle(): Promise<void> {
    await Promise.all(this.background);
  }
  private device(): string {
    let id = this.store.read<string | null>("device.json", null);
    if (!id) this.store.write("device.json", (id = randomUUID()));
    return id;
  }
  /** Tell this profile's other devices about something done here. Best effort, and nothing is sent unless linked. */
  private async mirror(what: "outbox" | "answered" | "contact" | "removed" | "relays", data: unknown): Promise<void> {
    if (!this.prefs().linked) return;
    try {
      await this.send({ agent: this.agentPub, relays: this.config.relays, inbox: this.inboxList() } as Contact, { type: "mirror", body: { what, device: this.device(), data } });
    } catch { /* the other device catches up from the relays when it can */ }
  }
  /** Apply a note from another of the owner's devices. Existing records are never overwritten by an older copy. */
  private onMirror(body: Extract<Envelope, { type: "mirror" }>["body"]): boolean {
    if (!this.prefs().linked || body.device === this.device()) return false;
    // Written by this same profile on another device, so it is trusted like a local file.
    const d = body.data as { id?: string; status: InboxItem["status"]; record?: CommitmentRecord; identity: string; block?: boolean } & Contact & OutboxItem & string[];
    switch (body.what) {
      case "outbox": {
        const all = this.outbox();
        if (typeof d?.id !== "string" || all.some((o) => o.id === d.id)) return false;
        this.store.write("outbox.json", [...all, d]);
        return true;
      }
      case "answered": {
        const inbox = this.inbox(), item = inbox.find((i) => i.id === d?.id);
        if (!item || item.status !== "open") return false;
        item.status = d.status;
        this.store.write("inbox.json", inbox);
        if (d.record && !this.commitments().some((r) => r.request_id === d.id && r.role === "responder")) this.store.write("commitments.json", [...this.commitments(), d.record]);
        return true;
      }
      case "contact":
        this.saveContact(d, true);
        return true;
      case "removed":
        this.removeContact(d.identity, { block: d.block, quiet: true });
        return true;
      case "relays":
        this.setRelays(d);
        return true;
    }
  }

  /** Messages in either direction whose subject, details, note or contact name contain the text. Newest first. */
  search(text: string): { dir: "in" | "out"; at: number; item: InboxItem | OutboxItem }[] {
    const q = text.trim().toLowerCase();
    if (!q) return [];
    const names = new Map(this.contacts().map((c) => [c.identity, c.name ?? ""]));
    const hit = (who: string, body: RequestBody, note?: string) =>
      [names.get(who), body.subject, body.details, note].some((v) => v?.toLowerCase().includes(q));
    return [
      ...this.inbox().filter((i) => hit(i.from, i.body)).map((item) => ({ dir: "in" as const, at: item.received_at, item })),
      ...this.outbox().filter((o) => hit(o.to, o.body, o.note)).map((item) => ({ dir: "out" as const, at: item.sent_at, item })),
    ].sort((a, b) => b.at - a.at).slice(0, 50);
  }
  contacts(): Contact[] {
    return this.store.read<Contact[]>("contacts.json", []);
  }
  inbox(): InboxItem[] {
    return this.store.read<InboxItem[]>("inbox.json", []);
  }
  outbox(): OutboxItem[] {
    return this.store.read<OutboxItem[]>("outbox.json", []);
  }
  commitments(): CommitmentRecord[] {
    return this.store.read<CommitmentRecord[]>("commitments.json", []);
  }
  recentLog(n = 50): unknown[] {
    return this.store.lines("log.jsonl", n);
  }

  /** Find a contact by self-declared name, npub or hex identity. Ambiguous names are refused. */
  resolveContact(ref: string): Contact {
    const all = this.contacts();
    const exact = all.find((c) => c.identity === ref || npubEncode(c.identity) === ref);
    if (exact) return exact; // a contact cannot shadow another by naming itself after that contact's ID
    const matches = all.filter((c) => c.name && c.name.toLowerCase() === ref.toLowerCase());
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) throw new Error(`"${ref}" matches several contacts; use the npub`);
    throw new Error(`No paired contact "${ref}"`);
  }

  /** Of the people the sender says also got a message, the ones this owner has paired with. Everyone else is left off. */
  coRecipients(item: InboxItem): Contact[] {
    const g = item.group;
    if (!g) return [];
    return this.contacts().filter((c) => !c.pending && c.identity !== item.from && g.to.includes(recipientTag(g.id, c.identity)));
  }

  prefs(): Prefs {
    return this.store.read<Prefs>("prefs.json", { inboxCheckMinutes: 15 });
  }
  setPrefs(patch: Partial<Prefs>): Prefs {
    const next = { ...this.prefs(), ...patch };
    this.store.write("prefs.json", next);
    return next;
  }
  /** The owner's status, while one is set and has not run out. */
  status(): { text: string; until?: number } | undefined {
    const s = this.prefs().status;
    return s && (!s.until || s.until > now()) ? s : undefined;
  }

  teams(): Team[] {
    return this.store.read<Team[]>("teams.json", []);
  }
  /** Create or replace a team; with no members, delete it. */
  setTeam(name: string, members: string[]): Team[] {
    const clean = name.trim().slice(0, 60);
    if (!clean || /[\p{Cc},]/u.test(clean)) throw new Error("Give the team a short name without commas");
    if (this.contacts().some((c) => c.name?.toLowerCase() === clean.toLowerCase())) throw new Error("A contact already has that name");
    const ids = [...new Set(members.map((m) => this.resolveContact(m).identity))];
    if (ids.length > MAX_RECIPIENTS) throw new Error(`A team can have at most ${MAX_RECIPIENTS} members`);
    const rest = this.teams().filter((t) => t.name.toLowerCase() !== clean.toLowerCase());
    const next = ids.length ? [...rest, { name: clean, members: ids }] : rest;
    this.store.write("teams.json", next);
    return next;
  }
  /** Contacts for a list of names, any of which may be a team. */
  private recipients(refs: string[]): { contacts: Contact[]; team?: string } {
    const teams = this.teams();
    let team: string | undefined;
    const ids = refs.flatMap((ref) => {
      const t = teams.find((x) => x.name.toLowerCase() === ref.trim().toLowerCase());
      if (!t) return [this.resolveContact(ref).identity];
      if (refs.length === 1) team = t.name;
      return t.members;
    });
    return { contacts: [...new Set(ids)].map((i) => this.resolveContact(i)), team };
  }

  /** Everything exchanged with one contact, oldest first. */
  conversation(ref: string): { dir: "in" | "out"; at: number; item: InboxItem | OutboxItem }[] {
    const c = this.resolveContact(ref);
    return [
      ...this.inbox().filter((i) => i.from === c.identity).map((item) => ({ dir: "in" as const, at: item.received_at, item })),
      ...this.outbox().filter((o) => o.to === c.identity).map((item) => ({ dir: "out" as const, at: item.sent_at, item })),
    ].sort((a, b) => a.at - b.at);
  }

  /** What has happened since the owner last caught up. Calling it moves the marker. */
  catchUp(): { since: number; messages: InboxItem[]; replies: OutboxItem[]; waiting: number; scheduled: number } {
    const since = this.prefs().lastCatchUp ?? 0;
    const result = {
      since,
      messages: this.inbox().filter((i) => i.received_at > since),
      replies: this.outbox().filter((o) => (o.updated_at ?? 0) > since),
      waiting: this.inbox().filter((i) => i.status === "open").length,
      scheduled: this.scheduled().length,
    };
    this.setPrefs({ lastCatchUp: now() });
    return result;
  }

  scheduled(): Scheduled[] {
    return this.store.read<Scheduled[]>("scheduled.json", []);
  }
  /** Queue a message for later. It goes out when a Termnl process is running at or after that time. */
  schedule(
    to: string[],
    raw: RequestBody,
    at: number,
    opts: { re?: string; unlessAnswered?: string; showRecipients?: boolean } = {},
  ): Scheduled {
    const body = requestBody.parse(raw);
    if (body.attachments?.length) throw new Error("Scheduled messages cannot carry files yet");
    if (!withinLimit(body, this.mandate().outbound)) throw new MandateError("Only messages inside the agent's mandate can be scheduled.");
    if (!(at > now()) || at > now() + 366 * DAY) throw new Error("Choose a time in the future, within a year");
    if (opts.unlessAnswered && !this.outbox().some((o) => o.id === opts.unlessAnswered)) throw new Error("No sent request with that id to wait on");
    const { contacts, team } = this.recipients(to);
    const all = this.scheduled();
    if (all.length >= 100) throw new Error("Too many scheduled messages; cancel some first");
    const item: Scheduled = { id: randomUUID(), to: contacts.map((c) => c.identity), body, at, re: opts.re, unless_answered: opts.unlessAnswered, showRecipients: opts.showRecipients, team };
    this.store.write("scheduled.json", [...all, item]);
    return item;
  }
  cancelScheduled(id: string): boolean {
    const all = this.scheduled();
    this.store.write("scheduled.json", all.filter((s) => s.id !== id));
    return all.some((s) => s.id === id);
  }

  /** The owner has now been shown their open messages: tell each sender, once. */
  async markShown(): Promise<void> {
    if (this.prefs().receipts === false) return;
    for (const i of this.inbox().filter((x) => x.status === "open" && x.receipted !== "shown")) {
      const c = this.contacts().find((x) => x.identity === i.from);
      if (c && !c.pending) await this.sendReceipt(c, i.id, "shown");
    }
  }

  // ---------- agent actions ----------

  /** Send a request. Outside the mandate it is refused unless the owner is sending it. */
  async sendRequest(to: string, raw: RequestBody, opts: { owner?: boolean; group?: OutboxItem["group"]; re?: string; keepUntil?: number } = {}): Promise<OutboxItem> {
    const body = requestBody.parse(raw);
    if (!opts.owner && !withinLimit(body, this.mandate().outbound)) {
      throw new MandateError(
        "This request is outside the agent's mandate. Ask the owner to send it with `termnl send`, or to widen mandate.json.",
      );
    }
    if (!opts.owner && body.attachments?.length && !this.mandate().agentMaySendFiles) {
      throw new MandateError("The agent is not allowed to send files. The owner can send them, or set agentMaySendFiles in the mandate.");
    }
    let contact = this.resolveContact(to);
    if (contact.pending) {
      await this.sync(); // their confirmation may already be waiting
      contact = this.resolveContact(to);
      if (contact.pending) throw new Error("This pairing is not confirmed yet. It completes once they have checked their inbox; then try again.");
    }
    // A reply can only point at something exchanged with this same contact. One copy of a group send may not qualify.
    const who = contact.identity;
    const known = !!opts.re && (this.inbox().some((i) => i.id === opts.re && i.from === who) || this.outbox().some((o) => o.id === opts.re && o.to === who));
    if (opts.re && !known && !opts.group) throw new Error("in_reply_to must be a message exchanged with this contact");
    const re = known ? opts.re : undefined;
    if (opts.keepUntil !== undefined && !(opts.keepUntil > now())) throw new Error("The expiry must be in the future");
    const id = randomUUID();
    const item: OutboxItem = {
      id,
      to: contact.identity,
      body,
      request_hash: this.requestHash(id, this.config.identity, contact.identity, body),
      sent_at: now(),
      status: "open",
      group: opts.group,
      re,
      keep_until: opts.keepUntil,
    };
    // Hidden recipients send nothing extra, so a receiver cannot even tell it went to others (see sendItem).
    try {
      await this.sendItem(contact, item);
      await this.mirror("outbox", item);
    } catch (e) {
      // Offline, or their relays are down: keep it and try again at every check, rather than lose it.
      if (!(e instanceof NoRelayError)) throw e;
      item.unsent = "queued";
    }
    const outbox = this.outbox();
    outbox.push(item);
    this.store.write("outbox.json", outbox);
    return item;
  }

  private sendItem(contact: Contact, item: OutboxItem): Promise<void> {
    const g = item.group;
    return this.send(contact, { type: "request", body: item.body }, item.id, {
      group: g?.shown ? { id: g.id, to: g.to.map((i) => recipientTag(g.id, i)), name: g.name } : undefined,
      re: item.re,
      keep_until: item.keep_until,
    });
  }

  /** Try queued messages again. The id is unchanged, so a copy that did get through is not shown twice. */
  private async flushUnsent(): Promise<void> {
    for (const q of this.outbox().filter((o) => o.unsent === "queued")) {
      const contact = this.contacts().find((c) => c.identity === q.to && !c.pending);
      let state: OutboxItem["unsent"] = "queued";
      try {
        if (!contact) throw new Error("no longer a contact");
        await this.sendItem(contact, q);
        await this.mirror("outbox", { ...q, unsent: undefined });
        state = undefined;
      } catch (e) {
        if (!(e instanceof NoRelayError) || q.sent_at < now() - RETRY_DAYS * DAY) state = "failed";
      }
      if (state === "queued") continue;
      const outbox = this.outbox(), item = outbox.find((o) => o.id === q.id);
      if (!item) continue;
      item.unsent = state;
      item.updated_at = now(); // so catching up mentions a message that could not be delivered
      this.store.write("outbox.json", outbox);
    }
  }

  /**
   * Send the same request to several contacts. Each copy is encrypted to one person, and every reply and
   * agreement stays one-to-one. Recipients see each other only when showRecipients is set.
   */
  async sendToMany(
    to: string[],
    raw: RequestBody,
    opts: { owner?: boolean; showRecipients?: boolean; re?: string; team?: string; keepUntil?: number } = {},
  ): Promise<{ group: string; sent: OutboxItem[]; failed: { to: string; error: string }[] }> {
    // Resolve everyone first, so a mistyped name stops the send before anyone gets a copy. A name may be a team.
    const { contacts, team } = this.recipients(to);
    if (contacts.length > MAX_RECIPIENTS) throw new Error(`At most ${MAX_RECIPIENTS} contacts at once`);
    if (contacts.length === 1) return { group: "", sent: [await this.sendRequest(contacts[0].identity, raw, { owner: opts.owner, re: opts.re, keepUntil: opts.keepUntil })], failed: [] };
    const name = opts.team ?? team;
    // A team is a known set of people, so its members see each other unless told otherwise.
    const group = { id: randomUUID(), to: contacts.map((c) => c.identity), shown: opts.showRecipients ?? !!name, name };
    const sent: OutboxItem[] = [], failed: { to: string; error: string }[] = [];
    for (const c of contacts) {
      try {
        sent.push(await this.sendRequest(c.identity, raw, { owner: opts.owner, group, re: opts.re, keepUntil: opts.keepUntil }));
      } catch (e) {
        if (e instanceof MandateError) throw e; // the same for every recipient, and nothing has been sent yet
        failed.push({ to: c.identity, error: (e as Error).message });
      }
    }
    return { group: group.id, sent, failed };
  }

  /** Answer an inbound request. Accepting requires mandate authority or owner approval. */
  async respond(
    requestId: string,
    decision: "accept" | "decline" | "counter",
    note?: string,
    opts: { owner?: boolean } = {},
  ): Promise<InboxItem> {
    const inbox = this.inbox();
    const item = inbox.find((i) => i.id === requestId);
    if (!item) throw new Error(`No inbound request ${requestId}`);
    if (item.status !== "open") throw new Error(`Request ${requestId} is already ${item.status}`);
    const contact = this.resolveContact(item.from);

    let commitment: SignedEvent | undefined;
    if (decision === "accept") {
      if (!opts.owner && item.authority !== "owner_approved" && !autoAcceptable(item.body, this.mandate().autoAccept)) {
        throw new MandateError(
          `Accepting this is outside the agent's mandate. The owner must approve it out of band with: termnl approve ${requestId}`,
        );
      }
      const content = canonical({
        request_id: item.id,
        request_hash: item.request_hash,
        terms: item.body,
        parties: { requester: item.from, responder: this.config.identity },
      });
      commitment = finalizeEvent(
        { kind: KIND.COMMITMENT, created_at: now(), tags: [["p", contact.agent]], content },
        this.sk,
      ) as SignedEvent;
      const all = this.commitments();
      all.push({ request_id: item.id, with: item.from, role: "responder", commitment, certs: { mine: this.agent.cert, theirs: contact.cert } });
      this.store.write("commitments.json", all);
    }
    if (decision === "counter" && !note) throw new Error("A counter needs a note explaining the change");

    await this.send(contact, { type: "response", body: { request_id: requestId, decision, note, commitment } });
    item.status = decision === "accept" ? "accepted" : decision === "decline" ? "declined" : "countered";
    this.store.write("inbox.json", inbox);
    await this.mirror("answered", { id: item.id, status: item.status, record: commitment && this.commitments().find((r) => r.request_id === item.id && r.role === "responder") });
    return item;
  }

  /**
   * Fetch new gift wraps from our relays and process them. Several processes can share one profile
   * (two agent sessions, a watcher), so only one checks at a time; the rest report nothing new.
   */
  async sync(): Promise<{ processed: number; dropped: number; capped?: true; busy?: true }> {
    const release = this.store.exclusive?.("sync");
    if (this.store.exclusive && !release) return { processed: 0, dropped: 0, busy: true };
    try {
      const result = await this.syncNow();
      await this.flushUnsent();
      this.prune();
      const p = this.prefs();
      if (p.autoRelays && now() - (p.lastRelayCheck ?? 0) > DAY) {
        this.setPrefs({ lastRelayCheck: now() });
        await this.healRelays().catch(() => undefined);
      }
      return result;
    } finally {
      release?.();
    }
  }

  /** Remove what has reached the sender's expiry, and answered messages older than the owner's keepDays. */
  private prune(): void {
    const keep = this.prefs().keepDays, t = now();
    const gone = (at: number, open: boolean, until?: number) => (until !== undefined && until <= t) || (!!keep && !open && at < t - keep * DAY);
    const inbox = this.inbox(), a = inbox.filter((i) => !gone(i.received_at, i.status === "open", i.keep_until));
    if (a.length !== inbox.length) this.store.write("inbox.json", a);
    const outbox = this.outbox(), b = outbox.filter((o) => !gone(o.sent_at, o.status === "open", o.keep_until));
    if (b.length !== outbox.length) this.store.write("outbox.json", b);
  }

  /**
   * Wait for messages without polling: one idle subscription per relay wakes a check when something
   * arrives. A slow fallback check covers relays that do not push. Returns a function that stops it.
   */
  watch(
    onNew: (news: { messages: InboxItem[]; replies: OutboxItem[] }) => void,
    opts: { fallbackMinutes?: number } = {},
  ): () => void {
    let timer: ReturnType<typeof setTimeout> | undefined, running = false, again = false;
    const check = async () => {
      if (running) { again = true; return; }
      running = true;
      try {
        const had = new Set(this.inbox().map((i) => i.id));
        const was = new Map(this.outbox().map((o) => [o.id, o.status]));
        const relays = this.readRelays().join();
        await this.sync();
        if (relays !== this.readRelays().join()) { sub.close(); sub = subscribe(); } // the relay list changed under us
        const messages = this.inbox().filter((i) => !had.has(i.id));
        const replies = this.outbox().filter((o) => was.has(o.id) && was.get(o.id) !== o.status);
        if (messages.length || replies.length) onNew({ messages, replies });
      } catch { /* offline or a relay is down; the next wake or fallback tries again */ }
      running = false;
      if (again) { again = false; wake(); }
    };
    // A burst of arrivals becomes one check.
    const wake = () => { clearTimeout(timer); timer = setTimeout(check, 1500); };
    // limit 0 asks for nothing stored, only what arrives from now on. No "since": gift-wrap timestamps are randomised into the past.
    const subscribe = () => this.pool.subscribeMany(this.readRelays(), { kinds: [KIND.GIFT_WRAP], "#p": [this.agentPub], limit: 0 }, {
      onevent: wake,
      onauth: async (event) => finalizeEvent(event, this.sk),
    });
    let sub = subscribe();
    const fallback = setInterval(check, Math.max(5, opts.fallbackMinutes ?? 15) * 60_000);
    // A local file read, not a network call: only goes to the relays when a scheduled message has fallen due.
    const due = setInterval(() => { if (this.scheduled().some((s) => s.at <= now())) void check(); }, 30_000);
    for (const t of [fallback, due]) (t as { unref?: () => void }).unref?.();
    return () => { clearTimeout(timer); clearInterval(fallback); clearInterval(due); sub.close(); };
  }

  private async syncNow(): Promise<{ processed: number; dropped: number; capped?: true }> {
    const seen = this.store.read<Seen>("seen.json", { wraps: [], envelopes: [], last_sync: 0 });
    // Gift-wrap timestamps are randomised up to two days into the past.
    const since = (seen.last_sync || now() - 5 * DAY) - 3 * DAY;
    const started = now();
    // querySync forwards this object at runtime; nostr-tools 2.26 omits
    // onauth only from its querySync declaration. Keep the wider variable type.
    const queryOptions = { maxWait: 5000, onauth: async (event: Parameters<typeof finalizeEvent>[0]) => finalizeEvent(event, this.sk) };
    const events = await this.pool.querySync(
      this.readRelays(),
      // ponytail: one capped page (newest first). Under a sustained flood older real messages can be missed;
      // the remedy is rotating the agent key, the upgrade path an inbox relay that restricts who may write.
      { kinds: [KIND.GIFT_WRAP], "#p": [this.agentPub], since, limit: this.syncLimit },
      queryOptions,
    );
    const capped = events.length >= this.syncLimit;

    const opened: { sender: string; env: Envelope }[] = [];
    const dayKeysHeld = this.inboxSecrets();
    let dropped = 0;
    for (const ev of events) {
      if (seen.wraps.includes(ev.id)) continue;
      try {
        opened.push(this.open(ev as SignedEvent, dayKeysHeld));
        seen.wraps.push(ev.id);
      } catch (e) {
        dropped++;
        // One that no key opens is left unseen and tried again at the next check.
        if (!(e instanceof NoKeyError)) seen.wraps.push(ev.id);
      }
    }
    opened.sort((a, b) => a.env.sent_at - b.env.sent_at);

    let processed = 0;
    const isContact = (agent: string) => this.contacts().some((c) => c.agent === agent);
    for (const { sender, env } of opened) {
      if (seen.envelopes.includes(env.id) || (env.expires_at && env.expires_at < now())) {
        dropped++;
        continue;
      }
      seen.envelopes.push(env.id);
      try {
        const ok = await this.handle(sender, env);
        // A receipt is bookkeeping, not something new for the owner, so it is not counted as processed.
        if ((env.type !== "receipt" && env.type !== "mirror") || !ok) ok ? processed++ : dropped++;
        // Only paired contacts reach the log, so a stranger cannot flood it or push out real history.
        if (ok || isContact(sender)) this.log("in", sender, ok ? env.type : `dropped:${env.type}`, env.id);
      } catch (e) {
        dropped++;
        if (isContact(sender)) this.log("in", sender, `rejected:${env.type}`, env.id, String((e as Error).message));
      }
    }
    seen.wraps = seen.wraps.slice(-5000);
    seen.envelopes = seen.envelopes.slice(-5000);
    const status = this.pool.listConnectionStatus();
    const reached = this.config.relays.filter((r) => status.get(normalizeURL(r))).length;
    // A check that reached no relay learned nothing, so the next one must look back just as far.
    if (reached) seen.last_sync = started;
    this.store.write("seen.json", seen);
    // Old keys go only when every relay we use was reachable: one that is down may still hold messages for those days.
    if (!capped && reached === this.config.relays.length) this.forgetOldKeys(started);
    await this.flushScheduled();
    return { processed, dropped, ...(capped && { capped }) };
  }

  close(): void {
    this.pool.close(this.readRelays());
    this.pool.destroy?.();
    this.sk.fill(0);
  }

  // ---------- internals ----------

  private pairingBody() {
    return { identity: this.config.identity, cert: this.agent.cert, relays: this.config.relays, name: this.config.name };
  }

  private requestHash(id: string, from: string, to: string, body: RequestBody): string {
    return sha256hex(canonical({ id, from, to, body }));
  }

  private saveContact(c: Contact, quiet = false): Contact {
    const known = this.contacts();
    // Pairing must never undo a rotation: an older certificate may belong to a retired, stolen key.
    const existing = known.find((x) => x.identity === c.identity);
    if (existing && c.cert.created_at < existing.cert.created_at) {
      throw new Error("That pairing uses an older key than the one on record for this contact");
    }
    // One agent key, one contact: otherwise messages from its real owner are attributed to someone else.
    if (known.some((x) => x.agent === c.agent && x.identity !== c.identity)) {
      throw new Error("That agent key already belongs to another contact");
    }
    const all = known.filter((x) => x.identity !== c.identity);
    all.push(c);
    this.store.write("contacts.json", all);
    if (!quiet) this.later(this.mirror("contact", c));
    return c;
  }

  private log(dir: string, peer: string, type: string, id: string, note?: string): void {
    this.store.append("log.jsonl", { ts: new Date().toISOString(), dir, peer, type, id, note });
  }

  private async send(
    to: Contact,
    msg: { type: Envelope["type"]; body: unknown },
    id: string = randomUUID(),
    extra: { group?: GroupInfo; re?: string; keep_until?: number } = {},
  ): Promise<void> {
    if (!certValid(this.agent.cert, this.config.identity, this.agentPub)) {
      throw new Error("This agent key has expired. The owner must run: termnl rotate");
    }
    const mine = this.inboxList();
    const env = envelope.parse({ v: 1, id, sent_at: now(), expires_at: now() + 14 * DAY, inbox: mine, ...extra, ...msg });
    const rumor = { kind: KIND.ENVELOPE, content: JSON.stringify(env), tags: [], created_at: now() };
    // Their key for today if they have told us one; otherwise their agent key, as before (older clients, or a list that ran out).
    let dayPub = mine && to.inbox ? to.inbox.keys[today() - to.inbox.from] : undefined;
    let wrap: ReturnType<typeof wrapEvent>;
    try {
      wrap = dayPub ? this.wrapFor(rumor, dayPub, to.agent) : wrapEvent(rumor, this.sk, to.agent);
    } catch {
      // A key in their list that is not a real public key must not stop the message.
      dayPub = undefined;
      wrap = wrapEvent(rumor, this.sk, to.agent);
    }
    const results = await Promise.allSettled(this.pool.publish(to.relays, wrap, {
      onauth: async (event) => finalizeEvent(event, this.sk), maxWait: 10000,
    }));
    const ok = results.filter((r) => r.status === "fulfilled").length;
    if (ok === 0) throw new NoRelayError(`None of the contact's ${to.relays.length} relay(s) accepted the message`);
    this.log("out", to.agent, env.type, env.id, `${ok}/${to.relays.length} relays${dayPub ? ", daily key" : ""}`);
  }

  /** Unwrap and authenticate a gift wrap. Returns the sender's agent key and the validated envelope. */
  private open(wrap: SignedEvent, dayKeysHeld: Uint8Array[] = []): { sender: string; env: Envelope } {
    if (wrap.kind !== KIND.GIFT_WRAP) throw new Error("not a gift wrap");
    if (wrap.content.length > MAX_WRAP_BYTES) throw new Error("oversized");
    if (!verifyEvent(wrap)) throw new Error("bad wrap signature");
    // It was encrypted either to the agent key or to one of our daily keys; the wrong key fails its integrity check.
    let seal: SignedEvent | undefined, key = this.sk;
    for (const k of [this.sk, ...dayKeysHeld]) {
      try { seal = JSON.parse(nip44.decrypt(wrap.content, nip44.getConversationKey(k, wrap.pubkey))) as SignedEvent; key = k; break; } catch { /* not this key */ }
    }
    if (!seal) throw new NoKeyError("no key opens this: it may be older than the keys still held");
    if (seal.kind !== KIND.SEAL || !verifyEvent(seal)) throw new Error("bad seal");
    const rumor = JSON.parse(nip44.decrypt(seal.content, nip44.getConversationKey(key, seal.pubkey)));
    if (rumor.pubkey !== seal.pubkey) throw new Error("seal and rumor authors differ");
    if (rumor.kind !== KIND.ENVELOPE) throw new Error("not an termnl envelope");
    return { sender: seal.pubkey, env: envelope.parse(JSON.parse(rumor.content)) };
  }

  /** Apply one authenticated envelope. Returns false when it is ignored. */
  private async handle(sender: string, env: Envelope): Promise<boolean> {
    const ok = await this.apply(sender, env);
    // Their daily keys ride on anything they send. Only a list at least as new as the one held is kept,
    // so a message that arrives late cannot bring back keys they have since deleted.
    const c = ok && env.inbox && env.type !== "mirror" ? this.contacts().find((x) => x.agent === sender) : undefined;
    // A list dated beyond tomorrow comes from a wrong clock and would block every later, correct one.
    if (c && env.inbox && env.inbox.from <= today() + 2 && env.inbox.from >= (c.inbox?.from ?? 0) && JSON.stringify(env.inbox) !== JSON.stringify(c.inbox)) this.saveContact({ ...c, inbox: env.inbox }, true);
    return ok;
  }

  private async apply(sender: string, env: Envelope): Promise<boolean> {
    // Only this profile's own key can speak for its other devices.
    if (env.type === "mirror") return sender === this.agentPub && this.onMirror(env.body);
    if (env.type === "knock") return this.onKnock(sender, env.body);
    if (env.type === "cert_update") return this.onCertUpdate(sender, env.body.cert);

    // Everything else must come from a paired contact whose certificate is still valid.
    const contact = this.contacts().find((c) => c.agent === sender);
    if (!contact || !certValid(contact.cert, contact.identity, contact.agent)) return false;
    // Any authenticated message from the key proves they hold it: the pairing is now confirmed.
    if (contact.pending) this.saveContact({ ...contact, pending: undefined });

    switch (env.type) {
      case "knock_accept":
        // Sent by their own agent key, so this is where a contact's relay list is allowed to change.
        if (env.body.identity !== contact.identity) return false;
        this.saveContact({ ...contact, pending: undefined, relays: env.body.relays, name: contact.name ?? env.body.name });
        return true;
      case "request": {
        const ok = this.onRequest(contact, env.id, env.body, env.group, env.re, env.keep_until);
        if (ok) await this.sendReceipt(contact, env.id, "delivered");
        return ok;
      }
      case "receipt":
        return this.onReceipt(contact, env.body);
      case "response":
        return this.onResponse(contact, env.body);
      case "cosign":
        return this.onCosign(contact, env.body);
    }
  }

  private async onKnock(sender: string, body: Extract<Envelope, { type: "knock" }>["body"]): Promise<boolean> {
    const invites = this.store.read<InviteRecord[]>("invites.json", []);
    const inv = invites.find((i) => i.code === body.code);
    if (!inv || inv.used || inv.expires < now()) return false;
    if (!certValid(body.cert, body.identity, sender) || this.blocked().includes(body.identity)) return false;
    const contact = this.saveContact({
      identity: body.identity,
      agent: sender,
      cert: body.cert,
      relays: body.relays,
      name: body.name,
      paired_at: now(),
    });
    inv.used = true;
    this.store.write("invites.json", invites);
    await this.send(contact, { type: "knock_accept", body: this.pairingBody() });
    return true;
  }

  private onCertUpdate(sender: string, cert: SignedEvent): boolean {
    const contact = this.contacts().find((c) => c.identity === cert.pubkey);
    if (!contact) return false;
    if (!certValid(cert, contact.identity, sender)) return false;
    if (cert.created_at <= contact.cert.created_at) return false; // never roll back to an older key
    this.saveContact({ ...contact, agent: sender, cert });
    return true;
  }

  /** Best effort, and silent when the owner has turned receipts off. A receipt never gets a receipt. */
  private async sendReceipt(contact: Contact, requestId: string, state: "delivered" | "shown"): Promise<void> {
    if (this.prefs().receipts === false) return;
    try {
      await this.send(contact, { type: "receipt", body: { request_id: requestId, state, note: state === "delivered" ? this.status()?.text : undefined } });
      const inbox = this.inbox();
      const item = inbox.find((i) => i.id === requestId);
      if (item) { item.receipted = state; this.store.write("inbox.json", inbox); }
    } catch { /* a courtesy: never fail a check over it */ }
  }

  private onReceipt(contact: Contact, body: Extract<Envelope, { type: "receipt" }>["body"]): boolean {
    const outbox = this.outbox();
    const item = outbox.find((o) => o.id === body.request_id && o.to === contact.identity);
    if (!item) return false;
    const r = item.receipt ?? {};
    r.delivered_at ??= now();
    if (body.state === "shown") r.shown_at ??= now();
    if (body.note) r.note = body.note;
    item.receipt = r;
    item.updated_at = now();
    this.store.write("outbox.json", outbox);
    return true;
  }

  private flushing = false;
  /** Send what has fallen due. It runs inside a check, so the profile lock stops two processes sending the same one. */
  private async flushScheduled(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      for (const s of this.scheduled().filter((x) => x.at <= now())) {
        let done = true;
        try {
          const waited = s.unless_answered ? this.outbox().find((o) => o.id === s.unless_answered) : undefined;
          if (!s.unless_answered || waited?.status === "open") {
            await this.sendToMany(s.to, s.body, { showRecipients: s.showRecipients, re: s.re, team: s.team });
          }
        } catch (e) {
          done = e instanceof MandateError || (s.tries ?? 0) >= 4; // stop trying what will never send
          this.log("out", s.to[0] ?? "", done ? "scheduled:dropped" : "scheduled:retry", s.id, String((e as Error).message));
        }
        const all = this.scheduled();
        this.store.write("scheduled.json", done ? all.filter((x) => x.id !== s.id) : all.map((x) => (x.id === s.id ? { ...x, tries: (x.tries ?? 0) + 1 } : x)));
      }
    } finally {
      this.flushing = false;
    }
  }

  private onRequest(contact: Contact, id: string, body: RequestBody, group?: GroupInfo, re?: string, keepUntil?: number): boolean {
    const inbox = this.inbox();
    // Keep record-level idempotency even after the bounded seen cache expires.
    if (inbox.some(item => item.id === id)) return false;
    const m = this.mandate();
    const open = inbox.filter((i) => i.from === contact.identity && i.status === "open").length;
    if (open >= m.maxOpenPerContact) return false;
    inbox.push({
      id,
      from: contact.identity,
      body,
      request_hash: this.requestHash(id, contact.identity, this.config.identity, body),
      received_at: now(),
      authority: autoAcceptable(body, m.autoAccept) ? "auto" : "needs_owner",
      status: "open",
      group,
      keep_until: keepUntil,
      // Keep the pointer only when it names something we really exchanged with this contact.
      re: re && (this.outbox().some((o) => o.id === re && o.to === contact.identity) || inbox.some((i) => i.id === re && i.from === contact.identity)) ? re : undefined,
    });
    this.store.write("inbox.json", inbox);
    return true;
  }

  private async onResponse(contact: Contact, body: Extract<Envelope, { type: "response" }>["body"]): Promise<boolean> {
    const outbox = this.outbox();
    const item = outbox.find((o) => o.id === body.request_id && o.to === contact.identity);
    if (!item || item.status !== "open") return false;

    if (body.decision !== "accept") {
      item.status = body.decision === "decline" ? "declined" : "countered";
      item.note = body.note;
      item.updated_at = now();
      this.store.write("outbox.json", outbox);
      return true;
    }

    // An acceptance must carry a commitment that matches exactly what we sent.
    const c = body.commitment;
    if (!c || c.kind !== KIND.COMMITMENT || c.pubkey !== contact.agent || !verifyEvent(c)) return false;
    const expected = canonical({
      request_id: item.id,
      request_hash: item.request_hash,
      terms: item.body,
      parties: { requester: this.config.identity, responder: contact.identity },
    });
    if (c.content !== expected) return false;

    const cosign = finalizeEvent(
      { kind: KIND.COSIGN, created_at: now(), tags: [["e", c.id], ["p", contact.agent]], content: "" },
      this.sk,
    ) as SignedEvent;
    const all = this.commitments();
    all.push({ request_id: item.id, with: contact.identity, role: "requester", commitment: c, cosign, certs: { mine: this.agent.cert, theirs: contact.cert } });
    this.store.write("commitments.json", all);
    item.status = "committed";
    item.updated_at = now();
    this.store.write("outbox.json", outbox);
    await this.send(contact, { type: "cosign", body: { request_id: item.id, cosign } });
    return true;
  }

  private onCosign(contact: Contact, body: Extract<Envelope, { type: "cosign" }>["body"]): boolean {
    const all = this.commitments();
    const rec = all.find((r) => r.request_id === body.request_id && r.with === contact.identity && r.role === "responder");
    if (!rec || rec.cosign) return false;
    const s = body.cosign;
    if (s.kind !== KIND.COSIGN || s.pubkey !== contact.agent || tag(s, "e") !== rec.commitment.id || !verifyEvent(s)) {
      return false;
    }
    rec.cosign = s;
    if (rec.certs) rec.certs.theirs = contact.cert; // the key that countersigned
    this.store.write("commitments.json", all);
    return true;
  }
}
