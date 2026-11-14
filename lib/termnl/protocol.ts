import { z } from "zod";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "nostr-tools/utils";
import { attachment } from "./files";

/**
 * Event kinds used by termnl. These are provisional numbers chosen for the
 * prototype and are NOT registered Nostr kinds. Only gift wraps (1059) are ever
 * published to relays; everything below travels inside the encrypted payload.
 */
export const KIND = {
  GIFT_WRAP: 1059,
  SEAL: 13,
  ENVELOPE: 4270, // rumor carrying an termnl envelope
  AGENT_CERT: 4271, // identity key certifies an agent key
  COMMITMENT: 4272, // responder signs agreed terms
  COSIGN: 4273, // requester countersigns a commitment
} as const;

export const MAX_WRAP_BYTES = 64 * 1024;
export const INVITE_PREFIX = "termnl1:";

const hex64 = z.string().regex(/^[0-9a-f]{64}$/);
const nostrEvent = z.object({
  id: hex64,
  pubkey: hex64,
  created_at: z.number().int(),
  kind: z.number().int(),
  tags: z.array(z.array(z.string())),
  content: z.string(),
  sig: z.string().regex(/^[0-9a-f]{128}$/),
});
export type SignedEvent = z.infer<typeof nostrEvent>;

export const relayList = z.array(z.string().max(200).refine((value) => {
  try {
    const url = new URL(value)
    return !url.username && !url.password && !url.hash && (url.protocol === "wss:" ||
      (url.protocol === "ws:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
  } catch { return false }
}, "Use wss:// relays (ws:// is allowed only on localhost)")).min(1).max(8);
// A public relay plus our own, so one being down or dropping messages does not stop delivery.
export const DEFAULT_RELAYS = ["wss://relay.primal.net", "wss://termnl.app/relay"];

export const requestBody = z.object({
  kind: z.enum(["request", "offer", "inform"]),
  subject: z.string().min(1).max(200),
  details: z.string().max(4000).optional(),
  value: z
    .object({ amount: z.number().nonnegative().finite(), currency: z.string().length(3) })
    .optional(),
  due: z.string().max(40).optional(),
  /** Pointers to encrypted files on Blossom servers. Covered by the request hash and the signed agreement. */
  attachments: z.array(attachment).max(4).optional(),
});
export type RequestBody = z.infer<typeof requestBody>;

const pairingBody = z.object({
  identity: hex64,
  cert: nostrEvent,
  relays: relayList,
  name: z.string().max(80).regex(/^[^\p{Cc}]*$/u, "no control characters").optional(),
});

/**
 * Travels with each copy of a message sent to several contacts, when the sender chose to show who else got it.
 * It sits outside the body, so it is not a term of any agreement and older clients ignore it.
 */
export const MAX_RECIPIENTS = 20;
/** Recipients are named by recipientTag, never by key: a receiver can recognise people they already trust and learns nothing about the rest. */
export const groupInfo = z.object({
  id: z.string().uuid(),
  to: z.array(hex64).min(2).max(MAX_RECIPIENTS),
  /** The sender's own name for the team it went to. Their words, not a verified fact. */
  name: z.string().max(60).regex(/^[^\p{Cc}]*$/u, "no control characters").optional(),
});
export type GroupInfo = z.infer<typeof groupInfo>;

export const envelope = z.discriminatedUnion("type", [
  z.object({ type: z.literal("knock"), body: pairingBody.extend({ code: z.string().min(16).max(64) }) }),
  z.object({ type: z.literal("knock_accept"), body: pairingBody }),
  z.object({ type: z.literal("request"), body: requestBody }),
  z.object({
    type: z.literal("response"),
    body: z.object({
      request_id: z.string().uuid(),
      decision: z.enum(["accept", "decline", "counter"]),
      note: z.string().max(2000).optional(),
      commitment: nostrEvent.optional(),
    }),
  }),
  z.object({ type: z.literal("cosign"), body: z.object({ request_id: z.string().uuid(), cosign: nostrEvent }) }),
  z.object({ type: z.literal("cert_update"), body: z.object({ cert: nostrEvent }) }),
  /** A courtesy note back to the sender: the message arrived, or was shown to its owner. Older clients drop it. */
  z.object({
    type: z.literal("receipt"),
    body: z.object({ request_id: z.string().uuid(), state: z.enum(["delivered", "shown"]), note: z.string().max(200).optional() }),
  }),
]).and(
  z.object({
    v: z.literal(1),
    id: z.string().uuid(),
    sent_at: z.number().int(),
    expires_at: z.number().int().optional(),
    group: groupInfo.optional(),
    /** The earlier message this one answers. Outside the body, like group. */
    re: z.string().uuid().optional(),
  }),
);
export type Envelope = z.infer<typeof envelope>;

export const invite = pairingBody.extend({ agent: hex64, code: z.string().min(16).max(64) });
export type Invite = z.infer<typeof invite>;

export const mandate = z.object({
  /** Inbound items the agent may accept without the owner. */
  autoAccept: z.object({
    kinds: z.array(z.enum(["request", "offer", "inform"])),
    maxAmount: z.number().nonnegative(),
    currency: z.string().length(3),
  }),
  /** What the agent may send without the owner. */
  outbound: z.object({
    kinds: z.array(z.enum(["request", "offer", "inform"])),
    maxAmount: z.number().nonnegative(),
    currency: z.string().length(3),
  }),
  maxOpenPerContact: z.number().int().positive(),
  /** Whether the agent may attach local files to what it sends. Off unless the owner turns it on. */
  agentMaySendFiles: z.boolean().default(false),
  /** Whether the agent may create and accept pairing invites when the owner asks in chat. Off unless the owner turns it on. */
  agentMayPair: z.boolean().default(false),
});
export type Mandate = z.infer<typeof mandate>;

/** Conservative default: the agent can read, inform and decline; anything of value needs the owner. */
export const DEFAULT_MANDATE: Mandate = {
  autoAccept: { kinds: ["inform"], maxAmount: 0, currency: "AUD" },
  outbound: { kinds: ["request", "inform"], maxAmount: 0, currency: "AUD" },
  maxOpenPerContact: 20,
  agentMaySendFiles: false,
  agentMayPair: false,
};

/** Deterministic JSON so both parties hash and sign identical bytes. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(",")}}`;
}

export function sha256hex(text: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(text)));
}

export function recipientTag(groupId: string, identity: string): string {
  return sha256hex(`termnl-recipient:${groupId}:${identity}`);
}

export function withinLimit(
  body: RequestBody,
  rule: { kinds: string[]; maxAmount: number; currency: string },
): boolean {
  if (!rule.kinds.includes(body.kind)) return false;
  if (!body.value) return true;
  return body.value.currency === rule.currency && body.value.amount <= rule.maxAmount;
}

export function encodeInvite(inv: Invite): string {
  const bytes = new TextEncoder().encode(JSON.stringify(invite.parse(inv)))
  return INVITE_PREFIX + btoa(String.fromCharCode(...bytes)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g, "");
}

export function decodeInvite(text: string): Invite {
  let t = text.trim();
  if (/^https?:\/\//.test(t)) {
    const url = new URL(t)
    if (url.pathname !== "/pair") throw new Error("Not a Termnl pairing link")
    t = decodeURIComponent(url.hash.slice(1))
  }
  if (t.length > 12000) throw new Error("Invite is too large")
  if (!t.startsWith(INVITE_PREFIX)) throw new Error("not an termnl invite");
  const encoded = t.slice(INVITE_PREFIX.length).replace(/-/g,"+").replace(/_/g,"/")
  const raw = new TextDecoder().decode(Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0)));
  return invite.parse(JSON.parse(raw));
}
