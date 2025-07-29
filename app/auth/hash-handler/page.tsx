"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"

export default function HashAuthHandler() {
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    const handleHashAuth = async () => {
      try {
        // Check if we have hash parameters (for password reset, etc.)
        const hashParams = new URLSearchParams(window.location.hash.substring(1))
        const accessToken = hashParams.get("access_token")
        const refreshToken = hashParams.get("refresh_token")
        const type = hashParams.get("type")

        console.log("Hash auth handler:", { accessToken: !!accessToken, refreshToken: !!refreshToken, type })

        if (accessToken && refreshToken) {
          // Set the session using the tokens
          const { data, error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          })

          console.log("Set session result:", { data, error })

          if (error) {
            console.error("Session set error:", error)
            router.push(`/?error=auth_error&message=${encodeURIComponent(error.message)}`)
            return
          }

          if (data.user) {
            if (type === "recovery") {
              // Password reset flow - redirect to password change page
              router.push("/auth/reset-password")
            } else if (data.user.email_confirmed_at) {
              // Email verified - redirect to terminal
              router.push("/terminal?verified=true")
            } else {
              // Email not verified
              router.push("/?error=email_not_verified")
            }
          }
        } else {
          // No valid hash parameters
          router.push("/?error=invalid_link")
        }
      } catch (err) {
        console.error("Hash auth error:", err)
        router.push("/?error=auth_error")
      }
    }

    handleHashAuth()
  }, [router, supabase.auth])

  return (
    <div className="min-h-screen bg-black text-green-400 font-mono flex items-center justify-center p-2 sm:p-4">
      <div className="text-center">
        <p className="text-xs sm:text-sm">{">"} PROCESSING AUTHENTICATION...</p>
        <div className="terminal-cursor-block mt-2">█</div>
      </div>
    </div>
  )
}
