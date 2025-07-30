"use server"

import { createClient } from "@/lib/supabase/server"

export async function joinChatAction(inviteCode: string) {
  try {
    const supabase = createClient()

    // Get current user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return {
        success: false,
        error: "Authentication required",
        redirectTo: `/?join=${inviteCode}`,
      }
    }

    // Check email verification
    if (!user.email_confirmed_at) {
      return {
        success: false,
        error: "Email verification required",
        redirectTo: `/?join=${inviteCode}&error=email_not_verified`,
      }
    }

    console.log("Server action: joining chat", { inviteCode, userId: user.id })

    // Single query to find chat and check access
    const { data: chatData, error: chatError } = await supabase
      .from("chats")
      .select("id, name, owner_id")
      .eq("invite_code", inviteCode.toUpperCase())
      .single()

    if (chatError || !chatData) {
      console.error("Chat not found:", chatError)
      return {
        success: false,
        error: "Invalid invite code",
      }
    }

    // Check if user is owner
    if (chatData.owner_id === user.id) {
      return {
        success: true,
        message: "Welcome back to your chat!",
        chatId: chatData.id,
        redirectTo: `/chat/${chatData.id}`,
      }
    }

    // Check if already participant (single query)
    const { data: existingParticipant } = await supabase
      .from("chat_participants")
      .select("id")
      .eq("chat_id", chatData.id)
      .eq("user_id", user.id)
      .maybeSingle()

    if (existingParticipant) {
      return {
        success: true,
        message: "Welcome back to the chat!",
        chatId: chatData.id,
        redirectTo: `/chat/${chatData.id}`,
      }
    }

    // Add user as participant
    const { error: joinError } = await supabase.from("chat_participants").insert({
      chat_id: chatData.id,
      user_id: user.id,
    })

    if (joinError) {
      console.error("Join error:", joinError)
      return {
        success: false,
        error: "Failed to join chat",
      }
    }

    return {
      success: true,
      message: `Successfully joined "${chatData.name}"!`,
      chatId: chatData.id,
      redirectTo: `/chat/${chatData.id}`,
    }
  } catch (error) {
    console.error("Server action error:", error)
    return {
      success: false,
      error: "An unexpected error occurred",
    }
  }
}
