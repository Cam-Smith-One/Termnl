"use client"

import { useState, useEffect } from "react"
import { useRouter, useParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"

export default function JoinChatPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const [user, setUser] = useState<any>(null)
  const [chatName, setChatName] = useState("")
  const router = useRouter()
  const params = useParams()
  const supabase = createClient()

  useEffect(() => {
    const handleJoin = async () => {
      try {
        console.log("Starting join process for code:", params.code)

        // Step 1: Check authentication with timeout
        const authTimeout = setTimeout(() => {
          setError("Authentication check timed out. Please try again.")
          setLoading(false)
        }, 10000) // 10 second timeout

        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession()
        clearTimeout(authTimeout)

        if (sessionError) {
          console.error("Session error:", sessionError)
          setError("Authentication error. Please refresh and try again.")
          setLoading(false)
          return
        }

        // Step 2: Handle unauthenticated users
        if (!session?.user) {
          console.log("No user session, redirecting to login")
          router.push(`/?join=${params.code}`)
          return
        }

        // Step 3: Check email verification
        const isEmailVerified =
          session.user.email_confirmed_at ||
          session.user.confirmed_at ||
          session.user.user_metadata?.email_verified === true

        if (!isEmailVerified) {
          console.log("Email not verified")
          router.push(`/?join=${params.code}&error=email_not_verified`)
          return
        }

        setUser(session.user)
        console.log("User authenticated:", session.user.email)

        // Step 4: Find and join chat with simple direct queries
        await processJoinRequest(params.code as string, session.user.id)
      } catch (err) {
        console.error("Join process error:", err)
        setError("Connection failed. Please check your internet and try again.")
        setLoading(false)
      }
    }

    handleJoin()
  }, [router, params.code, supabase])

  const processJoinRequest = async (inviteCode: string, userId: string) => {
    try {
      console.log("Processing join request:", { inviteCode, userId })

      // Step 1: Find chat by invite code with multiple timeout strategies
      console.log("Looking up chat with code:", inviteCode)

      // Try multiple variations of the invite code
      const codeVariations = [
        inviteCode.toUpperCase(),
        inviteCode.toLowerCase(),
        inviteCode.replace(/[^A-Z0-9]/g, ""), // Remove all non-alphanumeric
        inviteCode.replace(/[^A-Z0-9-]/g, ""), // Keep only letters, numbers, and dashes
      ]

      let chatData = null
      let chatError = null

      // Try each code variation
      for (const codeVariation of codeVariations) {
        console.log("Trying code variation:", codeVariation)

        const { data, error } = await Promise.race([
          supabase.from("chats").select("id, name, owner_id, invite_code").eq("invite_code", codeVariation).single(),
          new Promise((_, reject) => setTimeout(() => reject(new Error("Query timeout")), 10000)),
        ])

        if (!error && data) {
          chatData = data
          console.log("Found chat with variation:", codeVariation, "->", data.name)
          break
        } else if (error && !error.message.includes("PGRST116")) {
          // PGRST116 is "not found", other errors are more serious
          chatError = error
          console.error("Database error with code variation:", codeVariation, error)
        }
      }

      if (!chatData) {
        if (chatError) {
          console.error("Database error during chat lookup:", chatError)
          setError(`Database error: ${chatError.message}. Please try again.`)
        } else {
          console.error("Chat not found with any code variation")
          setError(`Invalid invite code "${inviteCode}". Please check the code and try again.`)
        }
        setLoading(false)
        return
      }

      console.log("Found chat:", chatData.name)
      setChatName(chatData.name)

      // Step 2: Check if user is already in chat
      if (chatData.owner_id === userId) {
        console.log("User is owner, redirecting")
        setSuccess("Welcome back! Redirecting to your chat...")
        setTimeout(() => router.push(`/chat/${chatData.id}`), 1500)
        setLoading(false)
        return
      }

      // Check if already a participant with timeout
      const { data: existingParticipant, error: participantError } = await Promise.race([
        supabase.from("chat_participants").select("id").eq("chat_id", chatData.id).eq("user_id", userId).single(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Participant check timeout")), 8000)),
      ])

      if (participantError && !participantError.message.includes("PGRST116")) {
        console.error("Error checking participant status:", participantError)
        setError(`Error checking membership: ${participantError.message}`)
        setLoading(false)
        return
      }

      if (existingParticipant) {
        console.log("User already participant, redirecting")
        setSuccess("You're already in this chat! Redirecting...")
        setTimeout(() => router.push(`/chat/${chatData.id}`), 1500)
        setLoading(false)
        return
      }

      // Step 3: Join the chat with timeout and retry
      console.log("Adding user as participant")

      let joinSuccess = false
      let joinError = null

      // Try joining with retries
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          console.log(`Join attempt ${attempt}/3`)

          const { error } = await Promise.race([
            supabase.from("chat_participants").insert({
              chat_id: chatData.id,
              user_id: userId,
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error("Join timeout")), 10000)),
          ])

          if (!error) {
            joinSuccess = true
            console.log("Successfully joined chat on attempt", attempt)
            break
          } else {
            joinError = error
            console.error(`Join attempt ${attempt} failed:`, error)

            // Wait before retry (except on last attempt)
            if (attempt < 3) {
              await new Promise((resolve) => setTimeout(resolve, 1000 * attempt))
            }
          }
        } catch (timeoutError) {
          console.error(`Join attempt ${attempt} timed out:`, timeoutError)
          joinError = timeoutError

          // Wait before retry (except on last attempt)
          if (attempt < 3) {
            await new Promise((resolve) => setTimeout(resolve, 1000 * attempt))
          }
        }
      }

      if (!joinSuccess) {
        console.error("All join attempts failed:", joinError)
        setError(`Failed to join chat after multiple attempts: ${joinError?.message || "Unknown error"}`)
        setLoading(false)
        return
      }

      console.log("Successfully joined chat")
      setSuccess(`Successfully joined "${chatData.name}"! Redirecting...`)
      setTimeout(() => router.push(`/chat/${chatData.id}`), 2000)
      setLoading(false)
    } catch (err) {
      console.error("Process join error:", err)
      setError(
        `An unexpected error occurred: ${err instanceof Error ? err.message : "Unknown error"}. Please try again.`,
      )
      setLoading(false)
    }
  }

  const retryJoin = () => {
    setError("")
    setSuccess("")
    setLoading(true)
    if (user) {
      processJoinRequest(params.code as string, user.id)
    } else {
      // Restart the whole process
      window.location.reload()
    }
  }

  return (
    <div className="min-h-screen bg-black text-green-400 font-mono flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        {/* Terminal Header */}
        <div className="bg-gray-800 px-4 py-2 rounded-t-lg border border-green-400">
          <span className="text-sm">TERMNL - Join Chat</span>
        </div>

        {/* Terminal Body */}
        <div className="bg-black border-green-400 border-t-0 border p-6 rounded-b-lg">
          <div className="space-y-6">
            {/* Logo */}
            <div className="text-center">
              <pre className="text-green-400 text-xs leading-tight">
                {`
████████╗███████╗██████╗ ███╗   ███╗███╗   ██╗██╗     
╚══██╔══╝██╔════╝██╔══██╗████╗ ████║████╗  ██║██║     
   ██║   █████╗  ██████╔╝██╔████╔██║██╔██╗ ██║██║     
   ██║   ██╔══╝  ██╔══██╗██║╚██╔╝██║██║╚██╗██║██║     
   ██║   ███████╗██║  ██║██║ ╚═╝ ██║██║ ╚████║███████╗
   ╚═╝   ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝╚═╝  ╚═══╝╚══════╝
`}
              </pre>
            </div>

            {/* Status */}
            <div className="text-sm space-y-2">
              <p>{">"} TERMNL Chat Network v1.0</p>
              <p>
                {">"} Processing invite code: {params.code}
              </p>
              <div className="border-b border-green-400 my-4"></div>
            </div>

            {/* Loading State */}
            {loading && !error && !success && (
              <div className="text-center space-y-4">
                <div className="text-lg">
                  <p>{">"} PROCESSING INVITE...</p>
                  {chatName && (
                    <p className="text-sm mt-2">
                      {">"} Found chat: {chatName}
                    </p>
                  )}
                </div>
                <div className="terminal-cursor-block">█</div>
                <p className="text-xs text-green-600">This may take a few moments...</p>
              </div>
            )}

            {/* Success State */}
            {success && (
              <div className="text-center space-y-4">
                <div className="text-green-400 border border-green-400 bg-gray-900 p-4">
                  <p className="text-lg">{">"} SUCCESS!</p>
                  <p className="text-sm mt-2">{success}</p>
                </div>
                <div className="terminal-cursor-block">█</div>
              </div>
            )}

            {/* Error State */}
            {error && (
              <div className="text-center space-y-4">
                <div className="text-red-400 border border-red-400 bg-gray-900 p-4">
                  <p className="text-lg">{">"} ERROR</p>
                  <p className="text-sm mt-2">{error}</p>
                  <div className="text-xs text-green-600 mt-4 space-y-1">
                    <p>Invite code: {params.code}</p>
                    <p>Possible causes:</p>
                    <p>• Invalid or expired invite code</p>
                    <p>• Network connection issues</p>
                    <p>• Chat was deleted</p>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <button
                    onClick={retryJoin}
                    className="bg-black border-2 border-green-400 text-green-400 hover:bg-green-400 hover:text-black font-mono px-4 py-2 transition-colors uppercase tracking-wider"
                  >
                    [RETRY]
                  </button>
                  <button
                    onClick={() => router.push("/")}
                    className="bg-black border-2 border-yellow-400 text-yellow-400 hover:bg-yellow-400 hover:text-black font-mono px-4 py-2 transition-colors uppercase tracking-wider"
                  >
                    [GO TO LOGIN]
                  </button>
                </div>
              </div>
            )}

            {/* Footer */}
            <div className="text-xs text-green-600 pt-4 border-t border-green-400 space-y-1">
              <p>{">"} TERMNL.APP - Secure Terminal Chat Network</p>
              <p>{">"} If you don't have an account, you'll be redirected to register</p>
              <p>{">"} All chats are encrypted end-to-end</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
