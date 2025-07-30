"use client"

import { useState, useEffect } from "react"
import { useRouter, useParams } from "next/navigation"
import { joinChatAction } from "@/app/actions/join-chat"

export default function JoinChatPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const router = useRouter()
  const params = useParams()

  useEffect(() => {
    const handleJoin = async () => {
      try {
        const inviteCode = params.code as string
        console.log("Client: Starting join process for code:", inviteCode)

        const result = await joinChatAction(inviteCode)

        if (result.success) {
          setSuccess(result.message || "Successfully joined chat!")

          // Redirect after showing success message
          setTimeout(() => {
            if (result.redirectTo) {
              router.push(result.redirectTo)
            }
          }, 1500)
        } else {
          if (result.redirectTo) {
            // Handle authentication redirects
            router.push(result.redirectTo)
            return
          }

          setError(result.error || "Failed to join chat")
        }
      } catch (err) {
        console.error("Client join error:", err)
        setError("Connection failed. Please try again.")
      } finally {
        setLoading(false)
      }
    }

    handleJoin()
  }, [router, params.code])

  const retryJoin = () => {
    setError("")
    setSuccess("")
    setLoading(true)

    // Reload the page to retry
    window.location.reload()
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
                </div>
                <div className="terminal-cursor-block">█</div>
                <p className="text-xs text-green-600">Please wait...</p>
              </div>
            )}

            {/* Success State */}
            {success && (
              <div className="text-center space-y-4">
                <div className="text-green-400 border border-green-400 bg-gray-900 p-4">
                  <p className="text-lg">{">"} SUCCESS!</p>
                  <p className="text-sm mt-2">{success}</p>
                  <p className="text-xs text-green-600 mt-2">Redirecting to chat...</p>
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
                    <p>• Authentication required</p>
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
              <p>{">"} Simplified join process for better reliability</p>
              <p>{">"} All chats are encrypted end-to-end</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
