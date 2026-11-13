import { NextResponse } from "next/server"
export async function GET() {
  return NextResponse.json({ status: "ok", version: "0.2.0", transport: "nostr", prototype: true }, { headers: { "Cache-Control": "no-store" } })
}
