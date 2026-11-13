import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"
const headers = { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" }
export async function GET(request: NextRequest) {
  const name = request.nextUrl.searchParams.get("name") || ""
  if (!/^[a-z0-9][a-z0-9_-]{2,19}$/.test(name)) return NextResponse.json({ names: {}, relays: {} }, { headers })
  try {
    const { data, error } = await createAdminClient().from("termnl_handles").select("name,pubkey,relays").eq("name", name).maybeSingle()
    if (error) return NextResponse.json({ names: {}, relays: {}, error: "Handles are not enabled yet" }, { status: 503, headers })
    return NextResponse.json(data ? { names: { [data.name]: data.pubkey }, relays: { [data.pubkey]: data.relays } } : { names: {}, relays: {} }, { headers })
  } catch { return NextResponse.json({ names: {}, relays: {}, error: "Handles are not enabled yet" }, { status: 503, headers }) }
}
