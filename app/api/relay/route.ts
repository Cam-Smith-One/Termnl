import { NextRequest, NextResponse } from "next/server"
import { upgradeWebSocket } from "@vercel/functions"
import { createAdminClient } from "@/lib/supabase/admin"
import { serveRelay, type RelayEvent, type RelayStore } from "@/lib/relay"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60
// Runs next to the database (Sydney): see "regions" in vercel.json. From the default US region every query cost about 0.8 s.

const TABLE = "termnl_relay_events"
const PER_RECIPIENT_PER_DAY = 500, GLOBAL_PER_HOUR = 5000, KEEP_DAYS = 30
const ago = (ms: number) => new Date(Date.now() - ms).toISOString()

// ponytail: the limits are counted with two extra queries per write; move them into one SQL function if traffic ever matters.
function supabaseStore(): RelayStore {
  const db = createAdminClient()
  const count = async (since: string, p?: string) => {
    let q = db.from(TABLE).select("id", { count: "exact", head: true }).gte("stored_at", since)
    if (p) q = q.eq("p", p)
    const { count: n, error } = await q
    if (error) throw new Error("error: relay storage is not available")
    return n ?? 0
  }
  return {
    async put(p, event) {
      const [forThem, forAll] = await Promise.all([count(ago(86400_000), p), count(ago(3600_000))])
      if (forThem >= PER_RECIPIENT_PER_DAY) throw new Error("rate-limited: this recipient's inbox is full for today")
      if (forAll >= GLOBAL_PER_HOUR) throw new Error("rate-limited: the relay is busy, try again later")
      const { error } = await db.from(TABLE).upsert({ id: event.id, p, created_at: event.created_at, event }, { onConflict: "id", ignoreDuplicates: true })
      if (error) throw new Error("error: relay storage is not available")
      if (Math.random() < 0.02) await db.from(TABLE).delete().lt("stored_at", ago(KEEP_DAYS * 86400_000))
    },
    async query(p, { since, until, limit }) {
      let q = db.from(TABLE).select("event").eq("p", p).order("created_at", { ascending: false }).limit(limit)
      if (since !== undefined) q = q.gte("created_at", since)
      if (until !== undefined) q = q.lte("created_at", until)
      const { data, error } = await q
      if (error) throw new Error("relay storage is not available")
      return (data ?? []).map(row => row.event as RelayEvent)
    },
  }
}

export async function GET(request: NextRequest) {
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return NextResponse.json({
      name: "Termnl relay", description: "Carries encrypted Termnl messages only. Anyone can deliver; only the addressee can read.",
      supported_nips: [1, 11, 42, 59], software: "https://termnl.app",
      limitation: { max_message_length: 100 * 1024, auth_required: true, restricted_writes: true },
    }, { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" } })
  }
  return upgradeWebSocket(ws => {
    serveRelay(ws, supabaseStore())
    setTimeout(() => ws.close(), 50_000) // clients fetch and leave; do not hold a function open for idle sockets
  }, { maxPayload: 128 * 1024 })
}
