import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function POST(request: NextRequest, { params }: { params: { code: string } }) {
  try {
    const { userId } = await request.json()

    if (!userId) {
      return NextResponse.json({ error: "User ID is required" }, { status: 400 })
    }

    const supabase = createClient()
    const inviteCode = params.code.toUpperCase()

    console.log("API join request:", { inviteCode, userId })

    // Find chat
    const { data: chatData, error: chatError } = await supabase
      .from("chats")
      .select("id, name, owner_id")
      .eq("invite_code", inviteCode)
      .single()

    if (chatError || !chatData) {
      return NextResponse.json({ error: "Invalid invite code" }, { status: 404 })
    }

    // Check if already in chat
    if (chatData.owner_id === userId) {
      return NextResponse.json({
        success: true,
        chatId: chatData.id,
        message: "Already owner",
      })
    }

    const { data: existing } = await supabase
      .from("chat_participants")
      .select("id")
      .eq("chat_id", chatData.id)
      .eq("user_id", userId)
      .single()

    if (existing) {
      return NextResponse.json({
        success: true,
        chatId: chatData.id,
        message: "Already participant",
      })
    }

    // Join chat
    const { error: joinError } = await supabase.from("chat_participants").insert({
      chat_id: chatData.id,
      user_id: userId,
    })

    if (joinError) {
      return NextResponse.json({ error: `Failed to join: ${joinError.message}` }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      chatId: chatData.id,
      chatName: chatData.name,
      message: "Successfully joined",
    })
  } catch (err) {
    console.error("Join API error:", err)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}
