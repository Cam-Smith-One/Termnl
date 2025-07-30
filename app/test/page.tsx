"use client"

import { useState } from "react"
import { createClient } from "@/lib/supabase/client"

export default function TestPage() {
  const [results, setResults] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const supabase = createClient()

  const addResult = (message: string) => {
    setResults((prev) => [...prev, `${new Date().toLocaleTimeString()}: ${message}`])
  }

  const runTests = async () => {
    setLoading(true)
    setResults([])

    try {
      addResult("Starting connectivity tests...")

      // Test 1: Basic Supabase connection
      addResult("Testing Supabase connection...")
      const { data: authData, error: authError } = await supabase.auth.getSession()
      if (authError) {
        addResult(`❌ Auth error: ${authError.message}`)
      } else {
        addResult(`✅ Auth connection successful`)
        if (authData.session?.user) {
          addResult(`✅ User authenticated: ${authData.session.user.email}`)
        } else {
          addResult(`ℹ️ No user session`)
        }
      }

      // Test 2: Database query
      addResult("Testing database query...")
      const { data: profileData, error: profileError } = await supabase.from("profiles").select("count").limit(1)

      if (profileError) {
        addResult(`❌ Database error: ${profileError.message}`)
      } else {
        addResult(`✅ Database query successful`)
      }

      // Test 3: Health check API
      addResult("Testing health check API...")
      try {
        const response = await fetch("/api/health")
        const healthData = await response.json()
        if (response.ok) {
          addResult(`✅ Health check API: ${healthData.status}`)
        } else {
          addResult(`❌ Health check failed: ${healthData.message}`)
        }
      } catch (apiError) {
        addResult(`❌ Health check API error: ${apiError}`)
      }

      // Test 4: Sample chat lookup
      addResult("Testing chat lookup...")
      const { data: chatData, error: chatError } = await supabase.from("chats").select("id, name, invite_code").limit(1)

      if (chatError) {
        addResult(`❌ Chat lookup error: ${chatError.message}`)
      } else {
        addResult(`✅ Chat lookup successful (found ${chatData?.length || 0} chats)`)
      }

      addResult("All tests completed!")
    } catch (err) {
      addResult(`❌ Test suite error: ${err}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-black text-green-400 font-mono p-4">
      <div className="max-w-4xl mx-auto">
        <div className="bg-gray-800 px-4 py-2 rounded-t-lg border border-green-400">
          <span className="text-sm">TERMNL - System Diagnostics</span>
        </div>

        <div className="bg-black border-green-400 border-t-0 border p-6 rounded-b-lg">
          <div className="space-y-4">
            <h1 className="text-lg">{">"} SYSTEM CONNECTIVITY TEST</h1>

            <button
              onClick={runTests}
              disabled={loading}
              className="bg-black border-2 border-green-400 text-green-400 hover:bg-green-400 hover:text-black font-mono px-4 py-2 transition-colors uppercase tracking-wider disabled:opacity-50"
            >
              {loading ? "[RUNNING TESTS...]" : "[RUN TESTS]"}
            </button>

            <div className="bg-gray-900 border border-green-400 p-4 min-h-64 max-h-96 overflow-y-auto">
              {results.length === 0 ? (
                <p className="text-green-600">Click "RUN TESTS" to start diagnostics...</p>
              ) : (
                <div className="space-y-1 text-xs">
                  {results.map((result, index) => (
                    <div key={index} className="font-mono">
                      {result}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="text-xs text-green-600 space-y-1">
              <p>{">"} This page tests basic connectivity to Supabase and APIs</p>
              <p>{">"} Use this to diagnose connection issues</p>
              <p>{">"} All tests should show ✅ for proper functionality</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
