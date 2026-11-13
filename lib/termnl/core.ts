import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from "nostr-tools/pure";
import { SimplePool } from "nostr-tools/pool";
import { bytesToHex, hexToBytes } from "nostr-tools/utils";
import * as nip44 from "nostr-tools/nip44";
import { wrapEvent } from "nostr-tools/nip59";
import { npubEncode } from "nostr-tools/nip19";
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
  relayList,
  type Envelope,
  type Mandate,
  type RequestBody,
  type SignedEvent,
} from "./protocol";
import type { Store } from "./store";

const now = () => Math.floor(Date.now() / 1000);
const toHex = bytesToHex;
const fromHex = hexToBytes;
const randomUUID = () => globalThis.crypto.randomUUID();
const DAY = 86400;

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
}

export interface InboxItem {
  id: string;
  from: string;
  body: RequestBody;
  request_hash: string;
  received_at: number;
  authority: "auto" | "needs_owner" | "owner_approved";
  status: "open" | "accepted" | "declined" | "countered";
}

export interface OutboxItem {
  id: string;
  to: string;
  body: RequestBody;
  request_hash: string;
  sent_at: number;
  status: "open" | "declined" | "countered" | "committed";
  note?: string;
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
    // An invite is only a claim: anyone can build one from a certificate they have seen.
    // The contact stays pending until its agent key actually writes to us.
    const proven = this.contacts().some((c) => c.identity === inv.identity && c.agent === inv.agent && !c.pending);
    const contact = this.saveContact({
      identity: inv.identity,
      agent: inv.agent,
      cert: inv.cert,
      relays: inv.relays,
      name: inv.name,
      paired_at: now(),
      ...(!proven && { pending: true }),
    });
    await this.send(contact, { type: "knock", body: { ...this.pairingBody(), code: inv.code } });
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
    this.pool.close(this.config.relays);
    this.config.relays = relays;
    this.store.write("config.json", this.config);
    return relays;
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

  // ---------- agent actions ----------

  /** Send a request. Outside the mandate it is refused unless the owner is sending it. */
  async sendRequest(to: string, raw: RequestBody, opts: { owner?: boolean } = {}): Promise<OutboxItem> {
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
    const id = randomUUID();
    const item: OutboxItem = {
      id,
      to: contact.identity,
      body,
      request_hash: this.requestHash(id, this.config.identity, contact.identity, body),
      sent_at: now(),
      status: "open",
    };
    await this.send(contact, { type: "request", body }, id);
    const outbox = this.outbox();
    outbox.push(item);
    this.store.write("outbox.json", outbox);
    return item;
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
      if (!opts.owner && item.authority !== "owner_approved" && !withinLimit(item.body, this.mandate().autoAccept)) {
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
    return item;
  }

  /** Fetch new gift wraps from our relays and process them. */
  async sync(): Promise<{ processed: number; dropped: number; capped?: true }> {
    const seen = this.store.read<Seen>("seen.json", { wraps: [], envelopes: [], last_sync: 0 });
    // Gift-wrap timestamps are randomised up to two days into the past.
    const since = (seen.last_sync || now() - 5 * DAY) - 3 * DAY;
    const started = now();
    // querySync forwards this object at runtime; nostr-tools 2.26 omits
    // onauth only from its querySync declaration. Keep the wider variable type.
    const queryOptions = { maxWait: 5000, onauth: async (event: Parameters<typeof finalizeEvent>[0]) => finalizeEvent(event, this.sk) };
    const events = await this.pool.querySync(
      this.config.relays,
      // ponytail: one capped page (newest first). Under a sustained flood older real messages can be missed;
      // the remedy is rotating the agent key, the upgrade path an inbox relay that restricts who may write.
      { kinds: [KIND.GIFT_WRAP], "#p": [this.agentPub], since, limit: this.syncLimit },
      queryOptions,
    );
    const capped = events.length >= this.syncLimit;

    const opened: { sender: string; env: Envelope }[] = [];
    let dropped = 0;
    for (const ev of events) {
      if (seen.wraps.includes(ev.id)) continue;
      seen.wraps.push(ev.id);
      try {
        opened.push(this.open(ev as SignedEvent));
      } catch {
        dropped++;
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
        ok ? processed++ : dropped++;
        // Only paired contacts reach the log, so a stranger cannot flood it or push out real history.
        if (ok || isContact(sender)) this.log("in", sender, ok ? env.type : `dropped:${env.type}`, env.id);
      } catch (e) {
        dropped++;
        if (isContact(sender)) this.log("in", sender, `rejected:${env.type}`, env.id, String((e as Error).message));
      }
    }
    seen.wraps = seen.wraps.slice(-5000);
    seen.envelopes = seen.envelopes.slice(-5000);
    seen.last_sync = started;
    this.store.write("seen.json", seen);
    return { processed, dropped, ...(capped && { capped }) };
  }

  close(): void {
    this.pool.close(this.config.relays);
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

  private saveContact(c: Contact): Contact {
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
    return c;
  }

  private log(dir: string, peer: string, type: string, id: string, note?: string): void {
    this.store.append("log.jsonl", { ts: new Date().toISOString(), dir, peer, type, id, note });
  }

  private async send(
    to: Contact,
    msg: { type: Envelope["type"]; body: unknown },
    id: string = randomUUID(),
  ): Promise<void> {
    if (!certValid(this.agent.cert, this.config.identity, this.agentPub)) {
      throw new Error("This agent key has expired. The owner must run: termnl rotate");
    }
    const env = envelope.parse({ v: 1, id, sent_at: now(), expires_at: now() + 14 * DAY, ...msg });
    const wrap = wrapEvent({ kind: KIND.ENVELOPE, content: JSON.stringify(env), tags: [], created_at: now() }, this.sk, to.agent);
    const results = await Promise.allSettled(this.pool.publish(to.relays, wrap, {
      onauth: async (event) => finalizeEvent(event, this.sk), maxWait: 10000,
    }));
    const ok = results.filter((r) => r.status === "fulfilled").length;
    if (ok === 0) throw new Error(`None of the contact's ${to.relays.length} relay(s) accepted the message`);
    this.log("out", to.agent, env.type, env.id, `${ok}/${to.relays.length} relays`);
  }

  /** Unwrap and authenticate a gift wrap. Returns the sender's agent key and the validated envelope. */
  private open(wrap: SignedEvent): { sender: string; env: Envelope } {
    if (wrap.kind !== KIND.GIFT_WRAP) throw new Error("not a gift wrap");
    if (wrap.content.length > MAX_WRAP_BYTES) throw new Error("oversized");
    if (!verifyEvent(wrap)) throw new Error("bad wrap signature");
    const seal = JSON.parse(nip44.decrypt(wrap.content, nip44.getConversationKey(this.sk, wrap.pubkey))) as SignedEvent;
    if (seal.kind !== KIND.SEAL || !verifyEvent(seal)) throw new Error("bad seal");
    const rumor = JSON.parse(nip44.decrypt(seal.content, nip44.getConversationKey(this.sk, seal.pubkey)));
    if (rumor.pubkey !== seal.pubkey) throw new Error("seal and rumor authors differ");
    if (rumor.kind !== KIND.ENVELOPE) throw new Error("not an termnl envelope");
    return { sender: seal.pubkey, env: envelope.parse(JSON.parse(rumor.content)) };
  }

  /** Apply one authenticated envelope. Returns false when it is ignored. */
  private async handle(sender: string, env: Envelope): Promise<boolean> {
    if (env.type === "knock") return this.onKnock(sender, env.body);
    if (env.type === "cert_update") return this.onCertUpdate(sender, env.body.cert);

    // Everything else must come from a paired contact whose certificate is still valid.
    const contact = this.contacts().find((c) => c.agent === sender);
    if (!contact || !certValid(contact.cert, contact.identity, contact.agent)) return false;
    // Any authenticated message from the key proves they hold it: the pairing is now confirmed.
    if (contact.pending) this.saveContact({ ...contact, pending: undefined });

    switch (env.type) {
      case "knock_accept":
        return true;
      case "request":
        return this.onRequest(contact, env.id, env.body);
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
    if (!certValid(body.cert, body.identity, sender)) return false;
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

  private onRequest(contact: Contact, id: string, body: RequestBody): boolean {
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
      authority: withinLimit(body, m.autoAccept) ? "auto" : "needs_owner",
      status: "open",
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
