import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { validateHandleClaim } from "@/lib/termnl/handles"
import { serverOrigin } from "@/lib/server-origin"

export const runtime = "nodejs"
const reply = (body: unknown, status: number) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } })
export async function POST(request: NextRequest) {
  const raw = await request.text()
  if (raw.length > 8000) return reply({ error: "Claim too large" }, 413)
  let claim
  try { claim = validateHandleClaim(JSON.parse(raw), `${serverOrigin(request)}/api/handles`) }
  catch { return reply({ error: "Invalid claim: use a fresh identity-signed event with an 18-bit proof of work, matching URL, method and payload." }, 400) }
  try {
    const db = createAdminClient()
    const { data, error: lookupError } = await db.from("termnl_handles").select("name,pubkey").or(`name.eq.${claim.name},pubkey.eq.${claim.event.pubkey}`)
    if (lookupError) return reply({ error: "Handles are not enabled yet" }, 503)
    if (data?.some(row => row.name === claim.name && row.pubkey === claim.event.pubkey)) return reply({ handle: `${claim.name}@termnl.app` }, 200)
    if (data?.length) return reply({ error: "Handle is taken, or this identity already has a handle" }, 409)
    const { error } = await db.from("termnl_handles").insert({ name: claim.name, pubkey: claim.event.pubkey, relays: claim.relays, claim_event_id: claim.event.id })
    if (error) return reply({ error: error.code === "23505" ? "Handle is taken, or this identity already has a handle" : "Handles are not enabled yet" }, error.code === "23505" ? 409 : 503)
    return reply({ handle: `${claim.name}@termnl.app` }, 201)
  } catch { return reply({ error: "Handles are not enabled yet" }, 503) }
}
