"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { TerminalInput } from "@/components/terminal-input"

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    // Check if user is authenticated for password reset
    const checkAuth = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session?.user) {
        router.push("/?error=unauthorized")
      }
    }

    checkAuth()
  }, [router, supabase.auth])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError("")
    setSuccess("")

    if (password !== confirmPassword) {
      setError("Passwords do not match")
      setLoading(false)
      return
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters long")
      setLoading(false)
      return
    }

    try {
      const { error } = await supabase.auth.updateUser({
        password: password,
      })

      if (error) {
        setError(error.message)
      } else {
        setSuccess("Password updated successfully! Redirecting to terminal...")
        setTimeout(() => {
          router.push("/terminal")
        }, 2000)
      }
    } catch (err) {
      setError("An unexpected error occurred")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-black text-green-400 font-mono flex items-center justify-center p-2 sm:p-4">
      <div className="w-full max-w-2xl">
        {/* Terminal Header */}
        <div className="bg-gray-800 px-2 sm:px-4 py-2 rounded-t-lg border border-green-400">
          <div className="flex items-center gap-2">
            <span className="ml-2 sm:ml-4 text-xs sm:text-sm truncate">TERMNL v1.0 - Password Reset</span>
          </div>
        </div>

        {/* Terminal Body */}
        <div className="bg-black border-green-400 border-t-0 rounded-t-none border p-3 sm:p-6">
          <div className="space-y-4">
            <div className="text-xs sm:text-sm">
              <p>{">"} SYSTEM: Password Reset Terminal</p>
              <p>{">"} STATUS: Authenticated for password change</p>
              <p>{">"} DOMAIN: TERMNL.APP - Secure Connection</p>
              <div className="border-b border-green-400 my-4"></div>
            </div>

            {error && (
              <div className="text-red-400 text-xs sm:text-sm p-2 sm:p-3 border border-red-400 bg-gray-900">
                <p>
                  {">"} ERROR: {error}
                </p>
              </div>
            )}

            {success && (
              <div className="text-green-400 text-xs sm:text-sm p-2 sm:p-3 border border-green-400 bg-gray-900">
                <p>
                  {">"} SUCCESS: {success}
                </p>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs sm:text-sm mb-1">{">"} NEW PASSWORD:</label>
                <TerminalInput
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter new password..."
                  required
                />
              </div>

              <div>
                <label className="block text-xs sm:text-sm mb-1">{">"} CONFIRM PASSWORD:</label>
                <TerminalInput
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm new password..."
                  required
                />
              </div>

              <div className="flex flex-col sm:flex-row gap-2 sm:gap-4">
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full sm:w-auto bg-black border-2 border-green-400 text-green-400 hover:bg-green-400 hover:text-black font-mono px-3 sm:px-4 py-2 transition-colors uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed text-xs sm:text-sm"
                >
                  {loading ? "[UPDATING...]" : "[UPDATE PASSWORD]"}
                </button>

                <button
                  type="button"
                  onClick={() => router.push("/")}
                  className="w-full sm:w-auto bg-black border-2 border-yellow-400 text-yellow-400 hover:bg-yellow-400 hover:text-black font-mono px-3 sm:px-4 py-2 transition-colors uppercase tracking-wider text-xs sm:text-sm"
                >
                  [CANCEL]
                </button>
              </div>
            </form>

            <div className="text-[10px] sm:text-xs text-green-600 mt-4 sm:mt-6">
              <p>{">"} Password must be at least 6 characters long</p>
              <p>{">"} Use a strong password for better security</p>
              <p>{">"} You will be redirected after successful update</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
