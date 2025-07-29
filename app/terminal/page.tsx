"use client"

import { useState, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { generateSecureInviteCode, generateEncryptionKey } from "@/lib/encryption"
import { getBaseUrl } from "@/lib/constants"
import type { Database } from "@/lib/supabase/types"
import { TerminalInput } from "@/components/terminal-input"

type Chat = Database["public"]["Tables"]["chats"]["Row"] & {
  participants_count?: number
  last_message?: string
}

export default function TerminalPage() {
  const [user, setUser] = useState<any>(null)
  const [chats, setChats] = useState<Chat[]>([])
  const [newChatName, setNewChatName] = useState("")
  const [joinCode, setJoinCode] = useState("")
  const [showCreateChat, setShowCreateChat] = useState(false)
  const [showJoinChat, setShowJoinChat] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()

  useEffect(() => {
    // Check for verification success message
    const verified = searchParams.get("verified")
    if (verified === "true") {
      setSuccess("Welcome to TERMNL.APP! Your email has been verified successfully.")
      // Clear the URL parameter
      window.history.replaceState({}, "", "/terminal")
    }

    const getUser = async () => {
      try {
        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession()

        if (sessionError) {
          console.error("Terminal page - session error:", sessionError)
          router.push("/")
          return
        }

        if (!session?.user) {
          router.push("/")
          return
        }

        // Replace this section:
        // if (!session.user.email_confirmed_at) {
        //   router.push("/?error=email_not_verified")
        //   return
        // }

        // With this enhanced check:
        console.log("Terminal - User session data:", {
          email: session.user.email,
          email_confirmed_at: session.user.email_confirmed_at,
          user_metadata: session.user.user_metadata,
          app_metadata: session.user.app_metadata,
          confirmed_at: session.user.confirmed_at,
          email_verified: session.user.user_metadata?.email_verified,
        })

        // Check multiple possible verification indicators
        const isEmailVerified =
          session.user.email_confirmed_at ||
          session.user.confirmed_at ||
          session.user.user_metadata?.email_verified === true ||
          session.user.app_metadata?.email_verified === true

        if (!isEmailVerified) {
          router.push("/?error=email_not_verified")
          return
        }

        setUser(session.user)
        await loadChats(session.user.id)
        setLoading(false)
      } catch (err) {
        console.error("Terminal page - auth error:", err)
        router.push("/")
      }
    }

    getUser()
  }, [router, supabase.auth, searchParams])

  const loadChats = async (userId: string) => {
    try {
      // Get chats where user is owner or participant
      const { data: ownedChats, error: ownedError } = await supabase.from("chats").select("*").eq("owner_id", userId)

      const { data: participantChats, error: participantError } = await supabase
        .from("chat_participants")
        .select(`
          chats (*)
        `)
        .eq("user_id", userId)

      if (ownedError || participantError) {
        throw new Error("Failed to load chats")
      }

      const allChats = [...(ownedChats || []), ...(participantChats?.map((p) => p.chats).filter(Boolean) || [])]

      // Remove duplicates and add participant counts
      const uniqueChats = allChats.filter((chat, index, self) => index === self.findIndex((c) => c.id === chat.id))

      // Get participant counts for each chat
      const chatsWithCounts = await Promise.all(
        uniqueChats.map(async (chat) => {
          const { count } = await supabase
            .from("chat_participants")
            .select("*", { count: "exact", head: true })
            .eq("chat_id", chat.id)

          return {
            ...chat,
            participants_count: (count || 0) + 1, // +1 for owner
          }
        }),
      )

      setChats(chatsWithCounts)
    } catch (err) {
      setError("Failed to load chats")
    }
  }

  const createChat = async () => {
    if (!newChatName.trim() || !user) return

    try {
      const inviteCode = generateSecureInviteCode()
      const encryptionKey = generateEncryptionKey()
      const inviteUrl = `${getBaseUrl()}/join/${inviteCode}`

      const { data, error } = await supabase
        .from("chats")
        .insert({
          name: newChatName + ".chat",
          owner_id: user.id,
          invite_code: inviteCode,
          invite_url: inviteUrl,
          encryption_key: encryptionKey,
        })
        .select()
        .single()

      if (error) throw error

      await loadChats(user.id)
      setNewChatName("")
      setShowCreateChat(false)
      setSuccess(`Chat "${newChatName}.chat" created successfully!`)
    } catch (err) {
      setError("Failed to create chat")
    }
  }

  const joinChat = async () => {
    if (!joinCode.trim() || !user) return

    try {
      // Find chat by invite code
      const { data: chat, error: chatError } = await supabase
        .from("chats")
        .select("*")
        .eq("invite_code", joinCode.toUpperCase())
        .single()

      if (chatError || !chat) {
        setError("Invalid invite code")
        return
      }

      // Check if already a participant
      const { data: existing } = await supabase
        .from("chat_participants")
        .select("*")
        .eq("chat_id", chat.id)
        .eq("user_id", user.id)
        .single()

      if (existing || chat.owner_id === user.id) {
        setError("You are already in this chat")
        return
      }

      // Join the chat
      const { error: joinError } = await supabase.from("chat_participants").insert({
        chat_id: chat.id,
        user_id: user.id,
      })

      if (joinError) throw joinError

      await loadChats(user.id)
      setJoinCode("")
      setShowJoinChat(false)
      setSuccess(`Successfully joined "${chat.name}"!`)
    } catch (err) {
      setError("Failed to join chat")
    }
  }

  const openChat = (chatId: string) => {
    router.push(`/chat/${chatId}`)
  }

  const logout = async () => {
    await supabase.auth.signOut()
    router.push("/")
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-green-400 font-mono flex items-center justify-center p-2 sm:p-4">
        <div className="text-center">
          <p className="text-xs sm:text-sm">{">"} LOADING TERMINAL...</p>
          <div className="terminal-cursor-block mt-2">█</div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-black text-green-400 font-mono p-2 sm:p-4">
      <div className="max-w-6xl mx-auto">
        {/* Terminal Header */}
        <div className="bg-gray-800 px-2 sm:px-4 py-2 rounded-t-lg border border-green-400">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <span className="ml-2 sm:ml-4 text-xs sm:text-sm truncate">TERMNL.APP - File Explorer</span>
            </div>
            <div className="flex items-center gap-2 sm:gap-4 text-xs sm:text-sm">
              <span className="hidden sm:inline">USER: {user?.user_metadata?.username || user?.email}</span>
              <span className="sm:hidden">USER</span>
              <button
                onClick={logout}
                className="bg-black border-2 border-red-400 text-red-400 hover:bg-red-400 hover:text-black font-mono px-2 sm:px-3 py-1 transition-colors uppercase tracking-wider text-[10px] sm:text-xs"
              >
                [LOGOUT]
              </button>
            </div>
          </div>
        </div>

        {/* Terminal Body */}
        <div className="bg-black border-green-400 border-t-0 rounded-t-none border p-3 sm:p-6 min-h-[600px]">
          <div className="space-y-4">
            {/* System Info */}
            <div className="text-xs sm:text-sm">
              <p>{">"} TERMNL Chat Network v1.0</p>
              <p>{">"} DOMAIN: TERMNL.APP - Secure Connection</p>
              <p className="break-all">
                {">"} Directory: /home/{user?.user_metadata?.username || "user"}/chats/
              </p>
              <p>
                {">"} Total files: {chats.length}
              </p>
              <p className="hidden sm:block">
                {">"} Last login: {new Date().toLocaleString()}
              </p>
              <div className="border-b border-green-400 my-4"></div>
            </div>

            {success && (
              <div className="text-green-400 text-xs sm:text-sm p-2 sm:p-3 border border-green-400 bg-gray-900 mb-4">
                <p>
                  {">"} SUCCESS: {success}
                </p>
                <button
                  onClick={() => setSuccess("")}
                  className="mt-2 bg-black border-2 border-green-400 text-green-400 hover:bg-green-400 hover:text-black font-mono px-2 py-1 text-xs transition-colors uppercase tracking-wider"
                >
                  [DISMISS]
                </button>
              </div>
            )}

            {error && (
              <div className="text-red-400 text-xs sm:text-sm p-2 sm:p-3 border border-red-400 bg-gray-900 mb-4">
                <p>
                  {">"} ERROR: {error}
                </p>
                <button
                  onClick={() => setError("")}
                  className="mt-2 bg-black border-2 border-red-400 text-red-400 hover:bg-red-400 hover:text-black font-mono px-2 py-1 text-xs transition-colors uppercase tracking-wider"
                >
                  [DISMISS]
                </button>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-4 mb-6">
              <button
                onClick={() => setShowCreateChat(!showCreateChat)}
                className="w-full sm:w-auto bg-black border-2 border-green-400 text-green-400 hover:bg-green-400 hover:text-black font-mono px-3 sm:px-4 py-2 transition-colors uppercase tracking-wider text-xs sm:text-sm"
              >
                [CREATE CHAT]
              </button>
              <button
                onClick={() => setShowJoinChat(!showJoinChat)}
                className="w-full sm:w-auto bg-black border-2 border-green-400 text-green-400 hover:bg-green-400 hover:text-black font-mono px-3 sm:px-4 py-2 transition-colors uppercase tracking-wider text-xs sm:text-sm"
              >
                [JOIN CHAT]
              </button>
            </div>

            {/* Create Chat Form */}
            {showCreateChat && (
              <div className="bg-gray-900 border border-green-400 p-3 sm:p-4 mb-4 text-green-400">
                <div className="space-y-3">
                  <p className="text-xs sm:text-sm">{">"} CREATE NEW CHAT:</p>
                  <TerminalInput
                    type="text"
                    value={newChatName}
                    onChange={(e) => setNewChatName(e.target.value)}
                    placeholder="Enter chat name..."
                  />
                  <div className="flex flex-col sm:flex-row gap-2">
                    <button
                      onClick={createChat}
                      className="w-full sm:w-auto bg-black border-2 border-green-400 text-green-400 hover:bg-green-400 hover:text-black font-mono px-3 sm:px-4 py-2 transition-colors uppercase tracking-wider text-xs sm:text-sm"
                    >
                      [CREATE]
                    </button>
                    <button
                      onClick={() => setShowCreateChat(false)}
                      className="w-full sm:w-auto bg-black border-2 border-red-400 text-red-400 hover:bg-red-400 hover:text-black font-mono px-3 sm:px-4 py-2 transition-colors uppercase tracking-wider text-xs sm:text-sm"
                    >
                      [CANCEL]
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Join Chat Form */}
            {showJoinChat && (
              <div className="bg-gray-900 border border-green-400 p-3 sm:p-4 mb-4 text-green-400">
                <div className="space-y-3">
                  <p className="text-xs sm:text-sm">{">"} JOIN CHAT BY CODE:</p>
                  <TerminalInput
                    type="text"
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                    placeholder="Enter chat code (e.g., ABC-DEF-GHI-JKL)..."
                  />
                  <div className="flex flex-col sm:flex-row gap-2">
                    <button
                      onClick={joinChat}
                      className="w-full sm:w-auto bg-black border-2 border-green-400 text-green-400 hover:bg-green-400 hover:text-black font-mono px-3 sm:px-4 py-2 transition-colors uppercase tracking-wider text-xs sm:text-sm"
                    >
                      [JOIN]
                    </button>
                    <button
                      onClick={() => setShowJoinChat(false)}
                      className="w-full sm:w-auto bg-black border-2 border-red-400 text-red-400 hover:bg-red-400 hover:text-black font-mono px-3 sm:px-4 py-2 transition-colors uppercase tracking-wider text-xs sm:text-sm"
                    >
                      [CANCEL]
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* File Listing */}
            <div className="space-y-2">
              <p className="text-xs sm:text-sm">{">"} AVAILABLE CHAT ROOMS:</p>
              <div className="bg-gray-900 p-2 sm:p-4 rounded border border-green-400 text-green-400 overflow-x-auto">
                <div className="min-w-[600px] sm:min-w-0">
                  <div className="grid grid-cols-1 gap-1 text-xs sm:text-sm">
                    {/* Header */}
                    <div className="grid grid-cols-12 gap-2 pb-2 border-b border-green-400 font-bold">
                      <div className="col-span-4">FILENAME</div>
                      <div className="col-span-3">CODE</div>
                      <div className="col-span-2">USERS</div>
                      <div className="col-span-2">CREATED</div>
                      <div className="col-span-1">ACTION</div>
                    </div>

                    {/* Chat Files */}
                    {chats.length === 0 ? (
                      <div className="col-span-12 text-center py-4 text-green-600 text-xs sm:text-sm">
                        <p>No chat rooms found. Create or join one to get started.</p>
                        <div className="terminal-cursor-block mt-2 mx-auto">█</div>
                      </div>
                    ) : (
                      chats.map((chat) => (
                        <div
                          key={chat.id}
                          className="grid grid-cols-12 gap-2 py-1 hover:bg-green-400 hover:text-black cursor-pointer transition-colors"
                          onClick={() => openChat(chat.id)}
                        >
                          <div className="col-span-4 truncate">{chat.name}</div>
                          <div className="col-span-3 text-[10px] sm:text-xs">{chat.invite_code}</div>
                          <div className="col-span-2">{chat.participants_count || 1}</div>
                          <div className="col-span-2 text-[10px] sm:text-xs">
                            {new Date(chat.created_at).toLocaleDateString()}
                          </div>
                          <div className="col-span-1">
                            <span className="text-[10px] sm:text-xs bg-green-600 text-black px-1 py-0.5 rounded">
                              OPEN
                            </span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Footer Info */}
            <div className="text-[10px] sm:text-xs text-green-600 mt-4 sm:mt-6 pt-4 border-t border-green-400">
              <p>{">"} Use CREATE CHAT to start a new conversation</p>
              <p>{">"} Use JOIN CHAT to join an existing room with a code</p>
              <p>{">"} Click on any chat file to enter the room</p>
              <p>{">"} All messages are end-to-end encrypted</p>
              <p>{">"} Share TERMNL.APP with friends to join the network</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
