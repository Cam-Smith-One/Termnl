import { verifyEvent } from "nostr-tools/pure";

/**
 * A deliberately small Nostr relay for Termnl messages only.
 * - Anyone may deliver an encrypted gift wrap (they hide their sender, so writes cannot be tied to a contact).
 * - Only the addressee may read: a client must prove it holds the key before it can list messages sent to it.
 * ponytail: fetch-only. Events that arrive after a query is answered are not pushed; Termnl clients fetch and close.
 */
export const RELAY_URL = "wss://termnl.app/relay";
const GIFT_WRAP = 1059, AUTH = 22242, MAX_EVENT_BYTES = 100 * 1024, DAY = 86400;
const hex64 = /^[0-9a-f]{64}$/;

export interface RelayEvent { id: string; pubkey: string; created_at: number; kind: number; tags: string[][]; content: string; sig: string }
export interface RelayStore {
  /** Store one event addressed to `p`. Throw an Error whose message is the reason to refuse it. */
  put(p: string, event: RelayEvent): Promise<void>;
  query(p: string, range: { since?: number; until?: number; limit: number }): Promise<RelayEvent[]>;
}
interface Socket { send(data: string): void; on(event: "message", listener: (data: unknown) => void): unknown }

const wellFormed = (ev: unknown): ev is RelayEvent => {
  const e = ev as RelayEvent;
  return !!e && typeof e === "object" && hex64.test(e.id) && hex64.test(e.pubkey) && Number.isInteger(e.created_at) && Number.isInteger(e.kind) &&
    typeof e.content === "string" && /^[0-9a-f]{128}$/.test(e.sig) && Array.isArray(e.tags) && e.tags.length <= 20 &&
    e.tags.every((t) => Array.isArray(t) && t.length <= 5 && t.every((v) => typeof v === "string" && v.length <= 300));
};

export function serveRelay(ws: Socket, store: RelayStore, relayHost = new URL(RELAY_URL).host): void {
  const challenge = globalThis.crypto.randomUUID();
  let reader = "";
  const send = (...message: unknown[]) => ws.send(JSON.stringify(message));
  send("AUTH", challenge);

  ws.on("message", async (raw) => {
    const text = String(raw);
    let msg: unknown[];
    try { msg = JSON.parse(text); if (!Array.isArray(msg)) throw 0; } catch { return send("NOTICE", "invalid: expected a JSON array"); }
    const [type, a, ...filters] = msg;
    const now = Math.floor(Date.now() / 1000);
    try {
      if (type === "AUTH") {
        const ev = a;
        const tagOf = (name: string) => wellFormed(ev) ? ev.tags.find((t) => t[0] === name)?.[1] ?? "" : "";
        let host = ""; try { host = new URL(tagOf("relay")).host; } catch { /* no relay tag */ }
        const ok = wellFormed(ev) && ev.kind === AUTH && Math.abs(ev.created_at - now) < 600 && tagOf("challenge") === challenge && host === relayHost && verifyEvent(ev);
        if (ok) reader = (ev as RelayEvent).pubkey;
        return send("OK", wellFormed(ev) ? ev.id : "", ok, ok ? "" : "invalid: authentication failed");
      }
      if (type === "EVENT") {
        const ev = a;
        if (!wellFormed(ev)) return send("OK", "", false, "invalid: malformed event");
        const refuse = (reason: string) => send("OK", ev.id, false, reason);
        if (text.length > MAX_EVENT_BYTES) return refuse("invalid: too large");
        if (ev.kind !== GIFT_WRAP) return refuse("blocked: this relay only carries encrypted Termnl messages");
        const to = ev.tags.filter((t) => t[0] === "p");
        if (to.length !== 1 || !hex64.test(to[0][1])) return refuse("invalid: exactly one recipient is required");
        if (ev.created_at > now + 600 || ev.created_at < now - 3 * DAY) return refuse("invalid: timestamp out of range");
        if (!verifyEvent(ev)) return refuse("invalid: bad signature");
        try { await store.put(to[0][1], ev); } catch (e) { return refuse((e as Error).message); }
        return send("OK", ev.id, true, "");
      }
      if (type === "REQ") {
        const sub = String(a).slice(0, 64);
        if (!reader) return send("CLOSED", sub, "auth-required: sign in to read messages sent to your key");
        const wanted = filters as { kinds?: number[]; "#p"?: string[]; since?: number; until?: number; limit?: number }[];
        const own = wanted.length > 0 && wanted.length <= 4 && wanted.every((f) => f && typeof f === "object" && Array.isArray(f["#p"]) && f["#p"].length === 1 && f["#p"][0] === reader);
        if (!own) return send("CLOSED", sub, "restricted: you can only read messages sent to your own key");
        const seen = new Set<string>();
        for (const f of wanted) {
          if (f.kinds && !f.kinds.includes(GIFT_WRAP)) continue;
          const num = (v: unknown) => (Number.isFinite(v) ? Number(v) : undefined);
          for (const ev of await store.query(reader, { since: num(f.since), until: num(f.until), limit: Math.min(Math.max(1, num(f.limit) ?? 500), 500) })) {
            if (!seen.has(ev.id)) { seen.add(ev.id); send("EVENT", sub, ev); }
          }
        }
        return send("EOSE", sub);
      }
      if (type !== "CLOSE") send("NOTICE", "unsupported: this relay only handles EVENT, REQ, CLOSE and AUTH");
    } catch {
      send("NOTICE", "error: the relay could not complete that");
    }
  });
}
