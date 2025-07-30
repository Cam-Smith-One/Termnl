"use client"

import { useState, useEffect } from "react"
import { useRouter, useParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"

export default function JoinChatPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [chat, setChat] = useState<any>(null)
  const [user, setUser] = useState<any>(null)
  const [joining, setJoining] = useState(false)
  const [success, setSuccess] = useState("")
  const router = useRouter()
  const params = useParams()
  const supabase = createClient()

  useEffect(() => {
    const handleJoin = async () => {
      try {
        console.log("Join page loading for code:", params.code)

        // Check if user is authenticated first
        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession()

        if (sessionError) {
          console.error("Session error:", sessionError)
          setError("Authentication error. Please try refreshing the page.")
          setLoading(false)
          return
        }

        if (!session?.user) {
          console.log("No user session, redirecting to login with join code")
          // Redirect to login with join code in URL
          router.push(`/?join=${params.code}`)
          return
        }

        const isEmailVerified =
          session.user.email_confirmed_at ||
          session.user.confirmed_at ||
          session.user.user_metadata?.email_verified === true ||
          session.user.app_metadata?.email_verified === true

        if (!isEmailVerified) {
          console.log("Email not verified, redirecting to login")
          router.push(`/?join=${params.code}&error=email_not_verified`)
          return
        }

        setUser(session.user)
        console.log("User authenticated:", session.user.email)

        // Find chat by invite code with retry logic
        await findAndJoinChat(params.code as string, session.user.id, 0)
      } catch (err) {
        console.error("Join page error:", err)
        setError("An unexpected error occurred. Please try again.")
        setLoading(false)
      }
    }

    handleJoin()
  }, [router, params.code, supabase])

  const findAndJoinChat = async (inviteCode: string, userId: string, retryCount: number) => {
    try {
      console.log(`Finding chat with code: ${inviteCode}, retry: ${retryCount}`)

      // Add delay for retries
      if (retryCount > 0) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * retryCount))
      }

      // Try to use the secure function first
      try {
        console.log("Attempting to join via secure function...")
        const { data: chatId, error: joinError } = await supabase.rpc("join_chat_by_code", {
          input_invite_code: inviteCode.toUpperCase(),
          input_user_id: userId,
        })

        if (joinError) {
          if (joinError.message.includes("Invalid invite code")) {
            setError("Invalid or expired invite code")
            setLoading(false)
            return
          } else if (joinError.message.includes("already in chat")) {
            // User is already in chat, just redirect
            console.log("User already in chat, finding chat details...")
            const { data: userChats } = await supabase.rpc("get_user_chats", {
              input_user_id: userId,
            })
            const existingChat = userChats?.find((c) => c.invite_code === inviteCode.toUpperCase())
            if (existingChat) {
              console.log("Redirecting to existing chat:", existingChat.id)
              router.push(`/chat/${existingChat.id}`)
              return
            }
          } else {
            throw joinError
          }
        }

        if (chatId) {
          console.log("Successfully joined chat via function:", chatId)
          setSuccess("Successfully joined the chat!")
          setTimeout(() => {
            router.push(`/chat/${chatId}`)
          }, 1500)
          setLoading(false)
          return
        }
      } catch (funcError) {
        console.log("Function failed, trying direct approach:", funcError)

        // Fallback to direct database queries
        console.log("Attempting direct database approach...")

        // Find chat by invite code
        const { data: chatData, error: chatError } = await supabase
          .from("chats")
          .select("*")
          .eq("invite_code", inviteCode.toUpperCase())
          .single()

        if (chatError) {
          if (chatError.code === "PGRST116") {
            setError("Invalid or expired invite code")
          } else if (chatError.message?.includes("fetch") && retryCount < 3) {
            console.log(`Network error, retrying... (attempt ${retryCount + 1}/3)`)
            return findAndJoinChat(inviteCode, userId, retryCount + 1)
          } else {
            setError(`Failed to find chat: ${chatError.message}`)
          }
          setLoading(false)
          return
        }

        if (!chatData) {
          setError("Chat not found")
          setLoading(false)
          return
        }

        setChat(chatData)
        console.log("Found chat:", chatData.name)

        // Check if already a participant or owner
        if (chatData.owner_id === userId) {
          console.log("User is owner, redirecting to chat")
          router.push(`/chat/${chatData.id}`)
          return
        }

        const { data: existing } = await supabase
          .from("chat_participants")
          .select("*")
          .eq("chat_id", chatData.id)
          .eq("user_id", userId)
          .single()

        if (existing) {
          console.log("User already participant, redirecting to chat")
          router.push(`/chat/${chatData.id}`)
          return
        }

        // Join the chat
        console.log("Adding user as participant...")
        const { error: joinError } = await supabase.from("chat_participants").insert({
          chat_id: chatData.id,
          user_id: userId,
        })

        if (joinError) {
          console.error("Join error:", joinError)
          setError(`Failed to join chat: ${joinError.message}`)
          setLoading(false)
          return
        }

        console.log("Successfully joined chat via direct method")
        setSuccess("Successfully joined the chat!")
        setTimeout(() => {
          router.push(`/chat/${chatData.id}`)
        }, 1500)
      }

      setLoading(false)
    } catch (err) {
      console.error("Find and join error:", err)

      // Check if it's a network error and retry
      if (err instanceof TypeError && err.message.includes("fetch") && retryCount < 3) {
        console.log(`Network error caught, retrying... (attempt ${retryCount + 1}/3)`)
        return findAndJoinChat(inviteCode, userId, retryCount + 1)
      }

      setError("Network connection failed. Please check your internet and try again.")
      setLoading(false)
    }
  }

  const retryJoin = async () => {
    if (user && params.code) {
      setError("")
      setLoading(true)
      await findAndJoinChat(params.code as string, user.id, 0)
    }
  }

  return (
    <div className="min-h-screen bg-black text-green-400 font-mono flex items-center justify-center p-2 sm:p-4">
      <div className="w-full max-w-2xl">
        {/* Terminal Header */}
        <div className="bg-gray-800 px-2 sm:px-4 py-2 rounded-t-lg border border-green-400">
          <div className="flex items-center">
            <span className="ml-2 sm:ml-4 text-xs sm:text-sm truncate">TERMNL - Chat Invite</span>
          </div>
        </div>

        {/* Terminal Body */}
        <div className="bg-black border-green-400 border-t-0 rounded-t-none border p-3 sm:p-6">
          <div className="space-y-4">
            {/* ASCII Art Logo */}
            <pre className="text-green-400 text-[8px] sm:text-xs leading-tight mb-4 sm:mb-6 overflow-x-auto">
              {`
████████╗███████╗██████╗ ███╗   ███╗███╗   ██╗██╗     
╚══██╔══╝██╔════╝██╔══██╗████╗ ████║████╗  ██║██║     
   ██║   █████╗  ██████╔╝██╔████╔██║██╔██╗ ██║██║     
   ██║   ██╔══╝  ██╔══██╗██║╚██╔╝██║██║╚██╗██║██║     
   ██║   ███████╗██║  ██║██║ ╚═╝ ██║██║ ╚████║███████╗
   ╚═╝   ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝╚═╝  ╚═══╝╚══════╝
                                                       
           Welcome to the Terminal Chat Network
`}
            </pre>

            <div className="text-xs sm:text-sm">
              <p>{">"} TERMNL Chat Network v1.0</p>
              <p>{">"} DOMAIN: TERMNL.APP - Secure Connection</p>
              <p className="break-all">
                {">"} Processing invite code: {params.code}
              </p>
              <div className="border-b border-green-400 my-4"></div>
            </div>

            {loading && !error && !success && (
              <div className="text-center">
                <div className="text-green-400 text-sm sm:text-lg mb-4">
                  <p>{">"} PROCESSING INVITE...</p>
                  <p className="text-xs sm:text-sm mt-2">{">"} Please wait while we connect you to the chat...</p>
                </div>
                <div className="terminal-cursor-block">█</div>
              </div>
            )}

            {success && (
              <div className="text-center">
                <div className="text-green-400 text-sm sm:text-lg mb-4 p-3 sm:p-4 border border-green-400 bg-gray-900">
                  <p>
                    {">"} SUCCESS: {success}
                  </p>
                  <p className="text-xs sm:text-sm mt-2">{">"} Redirecting to chat room...</p>
                </div>
                <div className="terminal-cursor-block">█</div>
              </div>
            )}

            {error && (
              <div className="text-center">
                <div className="text-red-400 text-sm sm:text-lg mb-4 p-3 sm:p-4 border border-red-400 bg-gray-900">
                  <p>
                    {">"} ERROR: {error}
                  </p>
                  <div className="text-xs sm:text-sm mt-3 text-green-600">
                    <p>
                      {">"} Invite code: {params.code}
                    </p>
                    <p>{">"} This might be due to:</p>
                    <p>{">"} - Invalid or expired invite code</p>
                    <p>{">"} - Network connection issues</p>
                    <p>{">"} - Chat was deleted</p>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-2 sm:gap-4 justify-center">
                  <button
                    onClick={() => router.push("/")}
                    className="w-full sm:w-auto bg-black border-2 border-green-400 text-green-400 hover:bg-green-400 hover:text-black font-mono px-3 sm:px-4 py-2 transition-colors uppercase tracking-wider text-xs sm:text-sm"
                  >
                    [GO TO LOGIN]
                  </button>
                  <button
                    onClick={retryJoin}
                    className="w-full sm:w-auto bg-black border-2 border-yellow-400 text-yellow-400 hover:bg-yellow-400 hover:text-black font-mono px-3 sm:px-4 py-2 transition-colors uppercase tracking-wider text-xs sm:text-sm"
                  >
                    [RETRY]
                  </button>
                </div>
              </div>
            )}

            {chat && !loading && !error && !success && (
              <div className="text-center">
                <div className="text-green-400 text-sm sm:text-lg mb-4 p-3 sm:p-4 border border-green-400 bg-gray-900">
                  <p className="break-words">
                    {">"} FOUND CHAT: {chat.name}
                  </p>
                  <p className="text-xs sm:text-sm mt-2">{">"} Ready to join...</p>
                </div>

                <button
                  onClick={() => findAndJoinChat(params.code as string, user?.id, 0)}
                  disabled={joining}
                  className="w-full sm:w-auto bg-black border-2 border-green-400 text-green-400 hover:bg-green-400 hover:text-black font-mono px-3 sm:px-4 py-2 transition-colors uppercase tracking-wider text-xs sm:text-sm disabled:opacity-50"
                >
                  {joining ? "[JOINING...]" : "[JOIN CHAT]"}
                </button>
              </div>
            )}

            {/* Footer Info */}
            <div className="text-[10px] sm:text-xs text-green-600 mt-4 sm:mt-6 pt-4 border-t border-green-400">
              <p>{">"} SYSTEM INFO: Retro Terminal Chat v1.0</p>
              <p>{">"} PROTOCOL: ASCII-CHAT-85</p>
              <p>{">"} ENCRYPTION: AES-256 End-to-End</p>
              <p>{">"} DOMAIN: TERMNL.APP - SSL Secured</p>
              <p>{">"} If you don't have an account, you'll be redirected to register</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
