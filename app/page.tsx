"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { getBaseUrl } from "@/lib/constants"
import { TerminalInput } from "@/components/terminal-input"
import { TerminalTypewriter } from "@/components/terminal-typewriter"

export default function LoginPage() {
  const [isLogin, setIsLogin] = useState(true)
  const [username, setUsername] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [showVerification, setShowVerification] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const [showForm, setShowForm] = useState(false)
  const [checkingAuth, setCheckingAuth] = useState(true)
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()

  const systemLines = [
    "> SYSTEM: Terminal Chat Network Online",
    "> STATUS: Ready for authentication",
    "> DOMAIN: TERMNL.APP - Secure Connection Established",
    `> Please ${isLogin ? "login" : "register"} to continue...`,
  ]

  useEffect(() => {
    // Show form after typewriter animation completes
    const timer = setTimeout(
      () => {
        setShowForm(true)
      },
      systemLines.length * 500 + 2000,
    ) // Adjust timing based on animation

    return () => clearTimeout(timer)
  }, [isLogin])

  useEffect(() => {
    // Check for URL parameters (errors or success messages)
    const urlError = searchParams.get("error")
    const verified = searchParams.get("verified")

    if (urlError) {
      switch (urlError) {
        case "verification_expired":
          setError("Email verification link has expired. Please request a new one.")
          break
        case "verification_failed":
          setError("Email verification failed. Please try again.")
          break
        case "verification_error":
          setError("An error occurred during verification. Please try again.")
          break
        default:
          setError("An error occurred. Please try again.")
      }
    }

    if (verified === "true") {
      setSuccess("Email verified successfully! You can now log in.")
    }

    // Check if user is already logged in
    const checkUser = async () => {
      try {
        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession()

        console.log("Session check:", { session, error: sessionError })

        if (sessionError) {
          console.error("Session error:", sessionError)
          setCheckingAuth(false)
          return
        }

        if (session?.user) {
          console.log("User found:", session.user)
          console.log("Email confirmed:", session.user.email_confirmed_at)

          if (session.user.email_confirmed_at) {
            console.log("Redirecting to terminal...")
            router.push("/terminal")
            return
          } else {
            setError("Please verify your email before logging in")
          }
        }

        setCheckingAuth(false)
      } catch (err) {
        console.error("Auth check error:", err)
        if (err instanceof Error) {
          setError(`Session check failed: ${err.message}`)
        } else {
          setError("Failed to check authentication status")
        }
        setCheckingAuth(false)
      }
    }

    checkUser()

    // Listen for auth state changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log("Auth state change:", event, session)

      if (event === "SIGNED_IN" && session?.user?.email_confirmed_at) {
        console.log("User signed in, redirecting to terminal...")
        router.push("/terminal")
      } else if (event === "SIGNED_OUT") {
        console.log("User signed out")
        setCheckingAuth(false)
      }
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [router, supabase.auth, searchParams])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError("")
    setSuccess("")

    try {
      if (isLogin) {
        console.log("Attempting login for:", email)
        // Login flow
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        })

        console.log("Login result:", { data, error })

        if (error) {
          console.error("Login error:", error)
          setError(error.message)
        } else if (data.user) {
          console.log("Login successful:", data.user)
          if (data.user.email_confirmed_at) {
            console.log("Email confirmed, should redirect...")
            // The onAuthStateChange listener will handle the redirect
          } else {
            setError("Please verify your email before logging in")
          }
        }
      } else {
        // Registration flow
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              username: username,
            },
            emailRedirectTo: `${getBaseUrl()}/auth/callback`,
          },
        })

        if (error) {
          setError(error.message)
        } else {
          setShowVerification(true)
        }
      }
    } catch (err) {
      console.error("Submit error:", err)
      if (err instanceof Error) {
        setError(`Authentication error: ${err.message}`)
      } else {
        setError("An unexpected error occurred during authentication")
      }
    } finally {
      setLoading(false)
    }
  }

  const resendVerification = async () => {
    if (!email) {
      setError("Please enter your email address")
      return
    }

    setLoading(true)
    try {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: email,
        options: {
          emailRedirectTo: `${getBaseUrl()}/auth/callback`,
        },
      })

      if (error) {
        setError(error.message)
      } else {
        setSuccess("Verification email sent! Please check your inbox.")
      }
    } catch (err) {
      setError("Failed to resend verification email")
    } finally {
      setLoading(false)
    }
  }

  // Show loading while checking authentication
  if (checkingAuth) {
    return (
      <div className="min-h-screen bg-black text-green-400 font-mono flex items-center justify-center">
        <div className="text-center">
          <p>{">"} CHECKING AUTHENTICATION...</p>
          <div className="terminal-cursor-block animate-pulse mt-2">█</div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-black text-green-400 font-mono flex items-center justify-center p-2 sm:p-4">
      <div className="w-full max-w-2xl">
        {/* Terminal Header */}
        <div className="bg-gray-800 px-2 sm:px-4 py-2 rounded-t-lg border border-green-400">
          <div className="flex items-center gap-2">
            <span className="ml-2 sm:ml-4 text-xs sm:text-sm truncate">TERMNL v1.0 - Authentication Terminal</span>
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
                    Est. 1985 - Retro Computing
                         Now Live at TERMNL.APP
`}
            </pre>

            {/* Animated System Messages */}
            <TerminalTypewriter lines={systemLines} speed={30} delay={300} className="mb-4" />

            {error && (
              <div className="text-red-400 text-xs sm:text-sm p-2 sm:p-3 border border-red-400 bg-gray-900">
                <p>
                  {">"} ERROR: {error}
                </p>
                {error.includes("verify your email") && (
                  <button
                    onClick={resendVerification}
                    disabled={loading}
                    className="mt-2 bg-black border border-green-400 text-green-400 hover:bg-green-400 hover:text-black font-mono px-2 py-1 text-xs disabled:opacity-50"
                  >
                    [RESEND VERIFICATION]
                  </button>
                )}
              </div>
            )}

            {success && (
              <div className="text-green-400 text-xs sm:text-sm p-2 sm:p-3 border border-green-400 bg-gray-900">
                <p>
                  {">"} SUCCESS: {success}
                </p>
              </div>
            )}

            {showVerification ? (
              <div className="space-y-4">
                <div className="text-xs sm:text-sm mb-4 p-3 sm:p-4 border border-green-400 bg-gray-900">
                  <p className="text-green-400">{">"} REGISTRATION SUCCESSFUL!</p>
                  <p className="text-green-400 mt-2">{">"} We have sent you an email verification link.</p>
                  <p className="text-green-400">
                    {">"} Please check your inbox and click the link to verify your account.
                  </p>
                  <p className="text-green-600 mt-3 break-all">
                    {">"} Email sent to: {email}
                  </p>
                  <p className="text-yellow-400 mt-3 text-xs">
                    {">"} The verification link will redirect you back to TERMNL.APP
                  </p>
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <button
                    onClick={() => {
                      setShowVerification(false)
                      setIsLogin(true)
                      setUsername("")
                      setEmail("")
                      setPassword("")
                    }}
                    className="w-full sm:w-auto bg-black border-2 border-green-400 text-green-400 hover:bg-green-400 hover:text-black font-mono px-3 sm:px-4 py-2 transition-colors uppercase tracking-wider text-xs sm:text-sm"
                  >
                    [BACK TO LOGIN]
                  </button>
                  <button
                    onClick={resendVerification}
                    disabled={loading}
                    className="w-full sm:w-auto bg-black border-2 border-yellow-400 text-yellow-400 hover:bg-yellow-400 hover:text-black font-mono px-3 sm:px-4 py-2 transition-colors uppercase tracking-wider text-xs sm:text-sm disabled:opacity-50"
                  >
                    [RESEND EMAIL]
                  </button>
                </div>
              </div>
            ) : showForm ? (
              <form onSubmit={handleSubmit} className="space-y-4">
                {!isLogin && (
                  <div>
                    <label className="block text-xs sm:text-sm mb-1">{">"} USERNAME:</label>
                    <TerminalInput
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="Enter username..."
                      required={!isLogin}
                    />
                  </div>
                )}

                <div>
                  <label className="block text-xs sm:text-sm mb-1">{">"} EMAIL:</label>
                  <TerminalInput
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Enter email..."
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs sm:text-sm mb-1">{">"} PASSWORD:</label>
                  <TerminalInput
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter password..."
                    required
                  />
                </div>

                <div className="flex flex-col sm:flex-row gap-2 sm:gap-4">
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full sm:w-auto bg-black border-2 border-green-400 text-green-400 hover:bg-green-400 hover:text-black font-mono px-3 sm:px-4 py-2 transition-colors uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed text-xs sm:text-sm"
                  >
                    {loading ? "[CONNECTING...]" : isLogin ? "[LOGIN]" : "[REGISTER]"}
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsLogin(!isLogin)}
                    className="w-full sm:w-auto bg-black border-2 border-green-400 text-green-400 hover:bg-green-400 hover:text-black font-mono px-3 sm:px-4 py-2 transition-colors uppercase tracking-wider text-xs sm:text-sm"
                  >
                    {isLogin ? "[REGISTER]" : "[LOGIN]"}
                  </button>
                </div>
              </form>
            ) : (
              <div className="text-center py-8">
                <div className="terminal-cursor-block animate-pulse">█</div>
              </div>
            )}

            <div className="text-[10px] sm:text-xs text-green-600 mt-4 sm:mt-6">
              <p>{">"} SYSTEM INFO: Retro Terminal Chat v1.0</p>
              <p>{">"} PROTOCOL: ASCII-CHAT-85</p>
              <p>{">"} ENCRYPTION: AES-256 End-to-End</p>
              <p>{">"} DOMAIN: TERMNL.APP - SSL Secured</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
