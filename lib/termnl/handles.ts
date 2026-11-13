import { z } from "zod"
import { verifyEvent, type EventTemplate } from "nostr-tools/pure"
import { getPow } from "nostr-tools/nip13"
import { canonical, sha256hex, relayList } from "./protocol"

export const HANDLE_DIFFICULTY = 18
export const reservedHandles = new Set(["admin", "administrator", "root", "termnl", "support", "help", "security", "api", "console", "www", "mail", "postmaster", "abuse", "owner", "system", "nostr"])
export const handleName = z.string().regex(/^[a-z0-9][a-z0-9_-]{2,19}$/).refine(name => !reservedHandles.has(name), "This handle is reserved")
export const handlePayload = z.object({ name: handleName, relays: relayList }).strict()
export const claimEvent = z.object({
  id: z.string().regex(/^[0-9a-f]{64}$/), pubkey: z.string().regex(/^[0-9a-f]{64}$/),
  created_at: z.number().int(), kind: z.literal(27235), content: z.literal(""),
  tags: z.array(z.array(z.string().max(500)).max(5)).max(12), sig: z.string().regex(/^[0-9a-f]{128}$/),
})
export const handleClaim = handlePayload.extend({ event: claimEvent }).strict()

export function handleTemplate(payload: z.infer<typeof handlePayload>, url: string): EventTemplate {
  const validated = handlePayload.parse(payload)
  return { kind: 27235, created_at: Math.floor(Date.now()/1000), content: "", tags: [
    ["u", url], ["method", "POST"], ["payload", sha256hex(canonical(validated))],
  ] }
}

export function validateHandleClaim(input: unknown, expectedUrl: string, at = Math.floor(Date.now()/1000)) {
  const data = handleClaim.parse(input)
  const uniqueTag = (key: string) => {
    const tags = data.event.tags.filter(tag => tag[0] === key)
    if (tags.length !== 1) throw new Error(`Exactly one ${key} tag required`)
    return tags[0]
  }
  if (Math.abs(data.event.created_at - at) > 60) throw new Error("Claim expired; sign a fresh claim")
  if (uniqueTag("u")[1] !== expectedUrl || uniqueTag("method")[1] !== "POST") throw new Error("Claim URL or method does not match")
  if (uniqueTag("payload")[1] !== sha256hex(canonical({ name: data.name, relays: data.relays }))) throw new Error("Claim payload was changed")
  const nonce = uniqueTag("nonce")
  if (!/^\d+$/.test(nonce[1] || "") || Number(nonce[2]) < HANDLE_DIFFICULTY || !Number.isFinite(Number(nonce[2]))) throw new Error("18-bit proof of work required")
  if (!verifyEvent(data.event) || getPow(data.event.id) < HANDLE_DIFFICULTY) throw new Error("Invalid signature or insufficient proof of work")
  return data
}
