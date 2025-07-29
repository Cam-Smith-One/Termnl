"use client"

import { useState, useEffect } from "react"
import { useRouter, useParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"

export default function JoinChatPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [chat, setChat] = useState<any>(null)
  const [user, setUser] = useState<any>(null)
  const router = useRouter()
  const params = useParams()
  const supabase = createClient()

  useEffect(() => {
    const handleJoin = async () => {
      try {
        // Check if user is authenticated
        const {
          data: { session },
        } = await supabase.auth.getSession()
        if (!session?.user || !session.user.email_confirmed_at) {
          router.push(`/?join=${params.code}`)
          return
        }

        setUser(session.user)

        // Find chat by invite code
        const { data: chatData, error: chatError } = await supabase
          .from("chats")
          .select("*")
          .eq("invite_code", params.code as string)
          .single()

        if (chatError || !chatData) {
          setError("Invalid or expired invite code")
          setLoading(false)
          return
        }

        setChat(chatData)

        // Check if already a participant
        const { data: existing } = await supabase
          .from("chat_participants")
          .select("*")
          .eq("chat_id", chatData.id)
          .eq("user_id", session.user.id)
          .single()

        if (existing || chatData.owner_id === session.user.id) {
          // Already in chat, redirect
          router.push(`/chat/${chatData.id}`)
          return
        }

        // Auto-join the chat
        const { error: joinError } = await supabase.from("chat_participants").insert({
          chat_id: chatData.id,
          user_id: session.user.id,
        })

        if (joinError) {
          setError("Failed to join chat")
        } else {
          router.push(`/chat/${chatData.id}`)
        }
      } catch (err) {
        setError("An unexpected error occurred")
      } finally {
        setLoading(false)
      }
    }

    handleJoin()
  }, [router, params.code, supabase])

  return (
    <div className="min-h-screen bg-black text-green-400 font-mono flex items-center justify-center p-2 sm:p-4">
      <div className="w-full max-w-2xl">
        <div className="bg-gray-800 px-2 sm:px-4 py-2 rounded-t-lg border border-green-400">
          <span className="text-xs sm:text-sm">TERMNL - Chat Invite</span>
        </div>

        <div className="bg-black border-green-400 border-t-0 rounded-t-none border p-3 sm:p-6">
          <div className="space-y-4 text-center">
            {error ? (
              <>
                <div className="text-red-400 text-sm sm:text-lg mb-4">
                  <p>
                    {">"} ERROR: {error}
                  </p>
                </div>
                <button
                  onClick={() => router.push("/")}
                  className="w-full sm:w-auto bg-black border-2 border-green-400 text-green-400 hover:bg-green-400 hover:text-black font-mono px-3 sm:px-4 py-2 transition-colors uppercase tracking-wider text-xs sm:text-sm"
                >
                  [BACK TO LOGIN]
                </button>
              </>
            ) : (
              <>
                <div className="text-green-400 text-sm sm:text-lg mb-4">
                  <p className="break-words">
                    {">"} JOINING CHAT: {chat?.name}
                  </p>
                  <p className="text-xs sm:text-sm mt-2">{">"} Please wait...</p>
                </div>
                <div className="terminal-cursor-block">█</div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
