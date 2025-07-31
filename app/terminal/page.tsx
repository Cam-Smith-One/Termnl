"use client"

import { useState, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { generateSecureInviteCode, generateEncryptionKey } from "@/lib/encryption"
import { getInviteBaseUrl } from "@/lib/constants"
import type { Database } from "@/lib/supabase/types"
import { TerminalInput } from "@/components/terminal-input"
import { joinChatAction } from "@/app/actions/join-chat"

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
  const [createLoading, setCreateLoading] = useState(false)
  const [joinLoading, setJoinLoading] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const [connectionStatus, setConnectionStatus] = useState<"connected" | "connecting" | "disconnected">("connected")
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
        setConnectionStatus("connecting")

        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession()

        if (sessionError) {
          console.error("Terminal page - session error:", sessionError)
          setConnectionStatus("disconnected")
          router.push("/")
          return
        }

        if (!session?.user) {
          setConnectionStatus("disconnected")
          router.push("/")
          return
        }

        // Check multiple possible verification indicators
        const isEmailVerified =
          session.user.email_confirmed_at ||
          session.user.confirmed_at ||
          session.user.user_metadata?.email_verified === true ||
          session.user.app_metadata?.email_verified === true

        if (!isEmailVerified) {
          setConnectionStatus("disconnected")
          router.push("/?error=email_not_verified")
          return
        }

        console.log("Terminal - User data:", {
          id: session.user.id,
          email: session.user.email,
          metadata: session.user.user_metadata,
        })

        setUser(session.user)
        setConnectionStatus("connected")
        await loadChats(session.user.id)
        setLoading(false)
      } catch (err) {
        console.error("Terminal page - auth error:", err)
        setConnectionStatus("disconnected")
        setError("Failed to authenticate. Please check your connection and try refreshing the page.")
        setLoading(false)
      }
    }

    getUser()
  }, [router, supabase.auth, searchParams])

  const loadChats = async (userId: string) => {
    try {
      console.log("Loading chats for user:", userId)

      // Simple, direct queries without complex RLS
      const { data: ownedChats, error: ownedError } = await supabase
        .from("chats")
        .select("*")
        .eq("owner_id", userId)
        .order("created_at", { ascending: false })

      if (ownedError) {
        console.error("Error loading owned chats:", ownedError)
        setError("Failed to load your chats")
        return
      }

      // Get participated chats
      const { data: participantData, error: participantError } = await supabase
        .from("chat_participants")
        .select("chat_id")
        .eq("user_id", userId)

      let participatedChats: any[] = []
      if (!participantError && participantData && participantData.length > 0) {
        const chatIds = participantData.map((p: any) => p.chat_id)

        const { data: participatedChatData, error: chatDataError } = await supabase
          .from("chats")
          .select("*")
          .in("id", chatIds)
          .order("created_at", { ascending: false })

        if (!chatDataError) {
          participatedChats = participatedChatData || []
        }
      }

      // Combine all chats
      const allChats = [...(ownedChats || []), ...participatedChats]

      // Remove duplicates
      const uniqueChats = allChats.filter((chat, index, self) => index === self.findIndex((c) => c.id === chat.id))

      // Get last message for each chat
      const chatsWithLastMessage = await Promise.all(
        uniqueChats.map(async (chat) => {
          try {
            const { data: lastMessage, error: messageError } = await supabase
              .from("messages")
              .select("created_at")
              .eq("chat_id", chat.id)
              .order("created_at", { ascending: false })
              .limit(1)
              .single()

            return {
              ...chat,
              participants_count: 1,
              last_message_at: lastMessage?.created_at || chat.created_at,
            }
          } catch (err) {
            // If no messages, use chat creation date
            return {
              ...chat,
              participants_count: 1,
              last_message_at: chat.created_at,
            }
          }
        }),
      )

      // Sort by last message time (most recent first)
      chatsWithLastMessage.sort((a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime())

      console.log("Chats loaded successfully:", chatsWithLastMessage.length)
      setChats(chatsWithLastMessage)
      setError("")
    } catch (err) {
      console.error("Failed to load chats:", err)
      setError("Failed to load chats. Please refresh the page.")
    }
  }

  const createChat = async () => {
    if (!newChatName.trim() || !user) return

    setCreateLoading(true)
    setError("")

    try {
      const inviteCode = generateSecureInviteCode()
      const encryptionKey = generateEncryptionKey()
      const inviteUrl = `${getInviteBaseUrl()}/join/${inviteCode}`

      console.log("Creating chat with:", {
        name: newChatName + ".chat",
        owner_id: user.id,
        invite_code: inviteCode,
      })

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

      if (error) {
        console.error("Chat creation error:", error)
        setError(`Failed to create chat: ${error.message}`)
        return
      }

      console.log("Chat created successfully:", data)
      await loadChats(user.id)
      setNewChatName("")
      setShowCreateChat(false)
      setSuccess(`Chat "${newChatName}.chat" created successfully!`)
    } catch (err) {
      console.error("Failed to create chat:", err)
      setError("Failed to create chat. Please try again.")
    } finally {
      setCreateLoading(false)
    }
  }

  // Simplified join chat using server action
  const joinChat = async () => {
    if (!joinCode.trim()) return

    setJoinLoading(true)
    setError("")

    try {
      console.log("Joining chat with code:", joinCode)

      const result = await joinChatAction(joinCode.toUpperCase())

      if (result.success) {
        await loadChats(user.id)
        setJoinCode("")
        setShowJoinChat(false)
        setSuccess(result.message || "Successfully joined the chat!")

        // Redirect to chat if provided
        if (result.redirectTo) {
          setTimeout(() => {
            router.push(result.redirectTo!)
          }, 1500)
        }
      } else {
        setError(result.error || "Failed to join chat")
      }
    } catch (err) {
      console.error("Failed to join chat:", err)
      setError("Failed to join chat. Please try again.")
    } finally {
      setJoinLoading(false)
    }
  }

  const openChat = (chatId: string) => {
    router.push(`/chat/${chatId}`)
  }

  const logout = async () => {
    await supabase.auth.signOut()
    router.push("/")
  }

  const formatLastMessageTime = (dateString: string) => {
    const messageDate = new Date(dateString)
    const today = new Date()

    // Check if it's today
    const isToday = messageDate.toDateString() === today.toDateString()

    if (isToday) {
      // Show just the time for today's messages
      return messageDate.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    } else {
      // Show date for older messages
      return messageDate.toLocaleDateString([], {
        month: "short",
        day: "numeric",
      })
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-green-400 font-mono flex items-center justify-center p-2 sm:p-4">
        <div className="text-center">
          <p className="text-xs sm:text-sm">
            {">"} {connectionStatus === "connecting" ? "CONNECTING TO TERMINAL..." : "LOADING TERMINAL..."}
          </p>
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
              <span
                className={`px-2 py-1 text-xs ${
                  connectionStatus === "connected"
                    ? "text-green-400"
                    : connectionStatus === "connecting"
                      ? "text-yellow-400"
                      : "text-red-400"
                }`}
              >
                [{connectionStatus.toUpperCase()}]
              </span>
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
                disabled={createLoading}
                className="w-full sm:w-auto bg-black border-2 border-green-400 text-green-400 hover:bg-green-400 hover:text-black font-mono px-3 sm:px-4 py-2 transition-colors uppercase tracking-wider text-xs sm:text-sm disabled:opacity-50"
              >
                [CREATE CHAT]
              </button>
              <button
                onClick={() => setShowJoinChat(!showJoinChat)}
                disabled={joinLoading}
                className="w-full sm:w-auto bg-black border-2 border-green-400 text-green-400 hover:bg-green-400 hover:text-black font-mono px-3 sm:px-4 py-2 transition-colors uppercase tracking-wider text-xs sm:text-sm disabled:opacity-50"
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
                    disabled={createLoading}
                  />
                  <div className="flex flex-col sm:flex-row gap-2">
                    <button
                      onClick={createChat}
                      disabled={createLoading || !newChatName.trim()}
                      className="w-full sm:w-auto bg-black border-2 border-green-400 text-green-400 hover:bg-green-400 hover:text-black font-mono px-3 sm:px-4 py-2 transition-colors uppercase tracking-wider text-xs sm:text-sm disabled:opacity-50"
                    >
                      {createLoading ? "[CREATING...]" : "[CREATE]"}
                    </button>
                    <button
                      onClick={() => setShowCreateChat(false)}
                      disabled={createLoading}
                      className="w-full sm:w-auto bg-black border-2 border-red-400 text-red-400 hover:bg-red-400 hover:text-black font-mono px-3 sm:px-4 py-2 transition-colors uppercase tracking-wider text-xs sm:text-sm disabled:opacity-50"
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
                    disabled={joinLoading}
                  />
                  <div className="flex flex-col sm:flex-row gap-2">
                    <button
                      onClick={joinChat}
                      disabled={joinLoading || !joinCode.trim()}
                      className="w-full sm:w-auto bg-black border-2 border-green-400 text-green-400 hover:bg-green-400 hover:text-black font-mono px-3 sm:px-4 py-2 transition-colors uppercase tracking-wider text-xs sm:text-sm disabled:opacity-50"
                    >
                      {joinLoading ? "[JOINING...]" : "[JOIN]"}
                    </button>
                    <button
                      onClick={() => setShowJoinChat(false)}
                      disabled={joinLoading}
                      className="w-full sm:w-auto bg-black border-2 border-red-400 text-red-400 hover:bg-red-400 hover:text-black font-mono px-3 sm:px-4 py-2 transition-colors uppercase tracking-wider text-xs sm:text-sm disabled:opacity-50"
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
                      <div className="col-span-2">LAST MSG</div>
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
                            {formatLastMessageTime(chat.last_message_at)}
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
              <p>{">"} All messages are encrypted end-to-end</p>
              <p>{">"} Share TERMNL.APP with friends to join the network</p>
              <p>{">"} Simplified join system for better reliability</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
