"use client"

import { useState, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { generateSecureInviteCode, generateEncryptionKey } from "@/lib/encryption"
import { getInviteBaseUrl } from "@/lib/constants"
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
  const [createLoading, setCreateLoading] = useState(false)
  const [joinLoading, setJoinLoading] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const [connectionStatus, setConnectionStatus] = useState<"connected" | "connecting" | "disconnected">("connected")
  const [retryAttempts, setRetryAttempts] = useState(0)
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

  // Enhanced loadChats function with retry logic and better error handling
  const loadChats = async (userId: string, retryCount = 0) => {
    const maxRetries = 3
    const retryDelay = Math.min(1000 * Math.pow(2, retryCount), 5000) // Exponential backoff, max 5s

    try {
      console.log(`Loading chats for user: ${userId} (attempt ${retryCount + 1}/${maxRetries + 1})`)

      if (retryCount > 0) {
        setConnectionStatus("connecting")
        await new Promise((resolve) => setTimeout(resolve, retryDelay))
      }

      // Test basic connectivity first
      try {
        const healthResponse = await fetch("/api/health", {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        })

        if (!healthResponse.ok) {
          throw new Error(`Health check failed: ${healthResponse.status}`)
        }

        console.log("Health check passed")
      } catch (healthError) {
        console.error("Health check failed:", healthError)

        if (retryCount < maxRetries) {
          console.log(`Health check failed, retrying in ${retryDelay}ms...`)
          setRetryAttempts(retryCount + 1)
          return loadChats(userId, retryCount + 1)
        } else {
          throw new Error("Cannot connect to server. Please check your internet connection.")
        }
      }

      // Try to load chats with timeout
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Request timeout")), 15000))

      // First, try using the secure function with timeout
      try {
        console.log("Attempting to load chats via secure function...")

        const functionPromise = supabase.rpc("get_user_chats", {
          input_user_id: userId,
        })

        const { data: userChats, error: functionError } = (await Promise.race([functionPromise, timeoutPromise])) as any

        if (!functionError && userChats) {
          console.log("Chats loaded via function:", userChats.length)
          const formattedChats = userChats.map((chat: any) => ({
            id: chat.id,
            name: chat.name,
            owner_id: chat.owner_id,
            invite_code: chat.invite_code,
            invite_url: chat.invite_url,
            encryption_key: chat.encryption_key,
            created_at: chat.created_at,
            updated_at: chat.updated_at,
            participants_count: chat.participants_count || 1,
          }))
          setChats(formattedChats)
          setConnectionStatus("connected")
          setRetryAttempts(0)
          if (error) setError("") // Clear any previous errors
          return
        } else {
          console.log("Function failed, falling back to direct queries:", functionError)
        }
      } catch (funcErr) {
        console.log("Function call failed, using fallback:", funcErr)
      }

      // Fallback: Use direct database queries with timeout
      console.log("Using direct database queries as fallback...")

      // Get owned chats with timeout
      const ownedChatsPromise = supabase
        .from("chats")
        .select("*")
        .eq("owner_id", userId)
        .order("created_at", { ascending: false })

      const { data: ownedChats, error: ownedError } = (await Promise.race([ownedChatsPromise, timeoutPromise])) as any

      if (ownedError) {
        console.error("Error loading owned chats:", ownedError)
        throw new Error(`Failed to load your chats: ${ownedError.message}`)
      }

      console.log("Owned chats loaded:", ownedChats?.length || 0)

      // Get participated chats - with timeout and error handling
      let participatedChats: any[] = []
      try {
        console.log("Loading participated chats...")

        const participantPromise = supabase.from("chat_participants").select("chat_id").eq("user_id", userId)

        const { data: participantData, error: participatedError } = (await Promise.race([
          participantPromise,
          timeoutPromise,
        ])) as any

        if (participatedError) {
          console.error("Error loading participant data:", participatedError)
          // Don't throw here, just log and continue with owned chats only
        } else if (participantData && participantData.length > 0) {
          // Get the actual chat data for participated chats
          const chatIds = participantData.map((p: any) => p.chat_id)

          const participatedChatsPromise = supabase
            .from("chats")
            .select("*")
            .in("id", chatIds)
            .order("created_at", { ascending: false })

          const { data: participatedChatData, error: chatDataError } = (await Promise.race([
            participatedChatsPromise,
            timeoutPromise,
          ])) as any

          if (chatDataError) {
            console.error("Error loading participated chat data:", chatDataError)
            // Don't throw, just continue without participated chats
          } else {
            participatedChats = participatedChatData || []
            console.log("Participated chats loaded:", participatedChats.length)
          }
        }
      } catch (participatedErr) {
        console.error("Participated chats query failed:", participatedErr)
        // Continue without participated chats
      }

      // Combine and format chats
      const allChats = [
        ...(ownedChats || []).map((chat: any) => ({ ...chat, participants_count: 1 })),
        ...participatedChats.map((chat: any) => ({ ...chat, participants_count: 1 })),
      ]

      // Remove duplicates (in case user owns and participates in same chat)
      const uniqueChats = allChats.filter((chat, index, self) => index === self.findIndex((c) => c.id === chat.id))

      console.log("Total unique chats loaded:", uniqueChats.length)
      setChats(uniqueChats)
      setConnectionStatus("connected")
      setRetryAttempts(0)

      // Clear any previous errors on success
      if (error) {
        setError("")
      }
    } catch (err) {
      console.error(`Failed to load chats (attempt ${retryCount + 1}):`, err)

      // Check if it's a network error
      const isNetworkError =
        err instanceof TypeError && (err.message.includes("fetch") || err.message.includes("network"))

      const isTimeoutError = err instanceof Error && err.message.includes("timeout")

      if ((isNetworkError || isTimeoutError) && retryCount < maxRetries) {
        console.log(`Network/timeout error, retrying in ${retryDelay}ms... (attempt ${retryCount + 1}/${maxRetries})`)
        setConnectionStatus("connecting")
        setRetryAttempts(retryCount + 1)
        return loadChats(userId, retryCount + 1)
      } else {
        // Final failure
        setConnectionStatus("disconnected")
        setRetryAttempts(0)

        let errorMessage = "Failed to load chats. "

        if (isNetworkError || isTimeoutError) {
          errorMessage += "Please check your internet connection and try again."
        } else {
          errorMessage += `Error: ${err instanceof Error ? err.message : "Unknown error"}`
        }

        setError(errorMessage)
      }
    }
  }

  const createChat = async () => {
    if (!newChatName.trim() || !user) return

    setCreateLoading(true)
    setError("")

    try {
      // First ensure the user profile exists
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single()

      if (profileError && profileError.code === "PGRST116") {
        // Profile doesn't exist, create it
        console.log("Creating user profile...")
        const username = user.user_metadata?.username || user.email?.split("@")[0] || "user"

        const { error: insertError } = await supabase.from("profiles").insert({
          id: user.id,
          username: username,
          email: user.email || "",
        })

        if (insertError) {
          console.error("Failed to create profile:", insertError)
          setError(`Failed to create user profile: ${insertError.message}`)
          setCreateLoading(false)
          return
        }
        console.log("User profile created successfully")
      } else if (profileError) {
        console.error("Profile check error:", profileError)
        setError(`Profile verification failed: ${profileError.message}`)
        setCreateLoading(false)
        return
      }

      const inviteCode = generateSecureInviteCode()
      const encryptionKey = generateEncryptionKey()
      const inviteUrl = `${getInviteBaseUrl()}/join/${inviteCode}`

      console.log("Creating chat with:", {
        name: newChatName + ".chat",
        owner_id: user.id,
        invite_code: inviteCode,
        invite_url: inviteUrl,
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
        setCreateLoading(false)
        return
      }

      console.log("Chat created successfully:", data)

      await loadChats(user.id)
      setNewChatName("")
      setShowCreateChat(false)
      setSuccess(`Chat "${newChatName}.chat" created successfully!`)
    } catch (err) {
      console.error("Failed to create chat:", err)
      setError("Failed to create chat. Please check your connection and try again.")
    } finally {
      setCreateLoading(false)
    }
  }

  const joinChat = async () => {
    if (!joinCode.trim() || !user) return

    setJoinLoading(true)
    setError("")

    try {
      console.log("Joining chat with code:", joinCode)

      // Try the secure function first
      try {
        const { data: chatId, error } = await supabase.rpc("join_chat_by_code", {
          input_invite_code: joinCode.toUpperCase(),
          input_user_id: user.id,
        })

        if (!error && chatId) {
          console.log("Successfully joined chat via function:", chatId)
          await loadChats(user.id)
          setJoinCode("")
          setShowJoinChat(false)
          setSuccess("Successfully joined the chat!")
          setJoinLoading(false)
          return
        } else {
          console.log("Function failed, trying direct approach:", error)
        }
      } catch (funcErr) {
        console.log("Function call failed, using direct approach:", funcErr)
      }

      // Fallback: Direct database approach
      console.log("Using direct database approach for joining...")

      // Find chat by invite code
      const { data: chatData, error: chatError } = await supabase
        .from("chats")
        .select("id, name, owner_id")
        .eq("invite_code", joinCode.toUpperCase())
        .single()

      if (chatError || !chatData) {
        setError("Invalid invite code or chat not found")
        setJoinLoading(false)
        return
      }

      // Check if already in chat
      if (chatData.owner_id === user.id) {
        setError("You are the owner of this chat")
        setJoinLoading(false)
        return
      }

      const { data: existingParticipant } = await supabase
        .from("chat_participants")
        .select("id")
        .eq("chat_id", chatData.id)
        .eq("user_id", user.id)
        .single()

      if (existingParticipant) {
        setError("You are already in this chat")
        setJoinLoading(false)
        return
      }

      // Join the chat
      const { error: joinError } = await supabase.from("chat_participants").insert({
        chat_id: chatData.id,
        user_id: user.id,
      })

      if (joinError) {
        console.error("Join error:", joinError)
        setError(`Failed to join chat: ${joinError.message}`)
        setJoinLoading(false)
        return
      }

      console.log("Successfully joined chat via direct approach")
      await loadChats(user.id)
      setJoinCode("")
      setShowJoinChat(false)
      setSuccess("Successfully joined the chat!")
    } catch (err) {
      console.error("Failed to join chat:", err)
      setError("Failed to join chat. Please check your connection and try again.")
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

  const retryLoadChats = async () => {
    if (user) {
      setError("")
      setLoading(true)
      setRetryAttempts(0)
      await loadChats(user.id)
      setLoading(false)
    }
  }

  // Monitor online/offline status
  useEffect(() => {
    const handleOnline = () => {
      console.log("Connection restored")
      setConnectionStatus("connected")
      if (user && (error || connectionStatus === "disconnected")) {
        console.log("Retrying after connection restored...")
        retryLoadChats()
      }
    }

    const handleOffline = () => {
      console.log("Connection lost")
      setConnectionStatus("disconnected")
    }

    window.addEventListener("online", handleOnline)
    window.addEventListener("offline", handleOffline)

    return () => {
      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
    }
  }, [user, error, connectionStatus])

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-green-400 font-mono flex items-center justify-center p-2 sm:p-4">
        <div className="text-center">
          <p className="text-xs sm:text-sm">
            {">"} {connectionStatus === "connecting" ? "CONNECTING TO TERMINAL..." : "LOADING TERMINAL..."}
          </p>
          {retryAttempts > 0 && (
            <p className="text-xs text-green-600 mt-2">
              {">"} Retry attempt {retryAttempts}/3...
            </p>
          )}
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

        {/* Connection Status Banner */}
        {connectionStatus !== "connected" && (
          <div
            className={`text-xs sm:text-sm p-2 border-x border-green-400 ${
              connectionStatus === "connecting" ? "bg-yellow-900/20 text-yellow-400" : "bg-red-900/20 text-red-400"
            }`}
          >
            <p>
              {">"} CONNECTION STATUS: {connectionStatus.toUpperCase()}
              {connectionStatus === "connecting" && retryAttempts > 0 && ` (Attempt ${retryAttempts}/3)`}
            </p>
          </div>
        )}

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
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={() => setError("")}
                    className="bg-black border-2 border-red-400 text-red-400 hover:bg-red-400 hover:text-black font-mono px-2 py-1 text-xs transition-colors uppercase tracking-wider"
                  >
                    [DISMISS]
                  </button>
                  <button
                    onClick={retryLoadChats}
                    className="bg-black border-2 border-yellow-400 text-yellow-400 hover:bg-yellow-400 hover:text-black font-mono px-2 py-1 text-xs transition-colors uppercase tracking-wider"
                  >
                    [RETRY]
                  </button>
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-4 mb-6">
              <button
                onClick={() => setShowCreateChat(!showCreateChat)}
                disabled={createLoading || connectionStatus === "disconnected"}
                className="w-full sm:w-auto bg-black border-2 border-green-400 text-green-400 hover:bg-green-400 hover:text-black font-mono px-3 sm:px-4 py-2 transition-colors uppercase tracking-wider text-xs sm:text-sm disabled:opacity-50"
              >
                [CREATE CHAT]
              </button>
              <button
                onClick={() => setShowJoinChat(!showJoinChat)}
                disabled={joinLoading || connectionStatus === "disconnected"}
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
                      <div className="col-span-2">CREATED</div>
                      <div className="col-span-1">ACTION</div>
                    </div>

                    {/* Chat Files */}
                    {chats.length === 0 ? (
                      <div className="col-span-12 text-center py-4 text-green-600 text-xs sm:text-sm">
                        <p>No chat rooms found. Create or join one to get started.</p>
                        {connectionStatus === "disconnected" && (
                          <p className="text-red-400 mt-2">Connection lost - chats may not be loading</p>
                        )}
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
              <p>{">"} All messages are encrypted end-to-end</p>
              <p>{">"} Share TERMNL.APP with friends to join the network</p>
              <p>{">"} Real-time messaging with secure functions enabled</p>
              {connectionStatus !== "connected" && (
                <p className="text-yellow-400 mt-2">{">"} Connection issues detected - some features may be limited</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
