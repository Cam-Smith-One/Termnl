"use client"

import { useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { getInviteBaseUrl } from "@/lib/constants"

export default function DebugPage() {
  const [testCode, setTestCode] = useState("")
  const [results, setResults] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const supabase = createClient()

  const addResult = (message: string) => {
    setResults((prev) => [...prev, `${new Date().toLocaleTimeString()}: ${message}`])
  }

  const testInviteCode = async () => {
    if (!testCode.trim()) return

    setLoading(true)
    setResults([])

    try {
      addResult(`Testing invite code: "${testCode}"`)
      addResult(`Base URL: ${getInviteBaseUrl()}`)
      addResult(`Full invite URL: ${getInviteBaseUrl()}/join/${testCode}`)

      // Test different variations of the code
      const variations = [
        testCode,
        testCode.toUpperCase(),
        testCode.toLowerCase(),
        testCode.replace(/[^A-Z0-9]/g, ""),
        testCode.replace(/[^A-Z0-9-]/g, ""),
      ]

      addResult(`Testing ${variations.length} code variations...`)

      for (const variation of variations) {
        addResult(`Trying: "${variation}"`)

        const { data, error } = await supabase
          .from("chats")
          .select("id, name, owner_id, invite_code, created_at")
          .eq("invite_code", variation)
          .single()

        if (error) {
          if (error.code === "PGRST116") {
            addResult(`  ❌ Not found`)
          } else {
            addResult(`  ❌ Error: ${error.message}`)
          }
        } else {
          addResult(`  ✅ Found chat: "${data.name}"`)
          addResult(`  📋 Chat ID: ${data.id}`)
          addResult(`  👤 Owner ID: ${data.owner_id}`)
          addResult(`  📅 Created: ${new Date(data.created_at).toLocaleString()}`)
          break
        }
      }

      // Test the join URL
      addResult("Testing join URL accessibility...")
      const joinUrl = `${getInviteBaseUrl()}/join/${testCode}`

      try {
        const response = await fetch(joinUrl, { method: "HEAD" })
        addResult(`Join URL status: ${response.status} ${response.statusText}`)
      } catch (fetchError) {
        addResult(`Join URL test failed: ${fetchError}`)
      }
    } catch (err) {
      addResult(`Test failed: ${err}`)
    } finally {
      setLoading(false)
    }
  }

  const listAllChats = async () => {
    setLoading(true)
    setResults([])

    try {
      addResult("Fetching all chats...")

      const { data, error } = await supabase
        .from("chats")
        .select("id, name, invite_code, created_at")
        .order("created_at", { ascending: false })
        .limit(10)

      if (error) {
        addResult(`❌ Error fetching chats: ${error.message}`)
      } else {
        addResult(`✅ Found ${data?.length || 0} chats`)

        data?.forEach((chat, index) => {
          addResult(`${index + 1}. "${chat.name}" - Code: ${chat.invite_code}`)
          addResult(`   URL: ${getInviteBaseUrl()}/join/${chat.invite_code}`)
        })
      }
    } catch (err) {
      addResult(`Failed to list chats: ${err}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-black text-green-400 font-mono p-4">
      <div className="max-w-4xl mx-auto">
        <div className="bg-gray-800 px-4 py-2 rounded-t-lg border border-green-400">
          <span className="text-sm">TERMNL - Invite Code Debug Tool</span>
        </div>

        <div className="bg-black border-green-400 border-t-0 border p-6 rounded-b-lg">
          <div className="space-y-4">
            <h1 className="text-lg">{">"} INVITE CODE DEBUGGER</h1>

            <div className="space-y-2">
              <label className="block text-sm">{">"} Test Invite Code:</label>
              <input
                type="text"
                value={testCode}
                onChange={(e) => setTestCode(e.target.value)}
                placeholder="Enter invite code (e.g., ABC-DEF-GHI-JKL)"
                className="w-full bg-black border border-green-400 text-green-400 font-mono p-2 focus:border-green-300 focus:outline-none"
              />
            </div>

            <div className="flex gap-4">
              <button
                onClick={testInviteCode}
                disabled={loading || !testCode.trim()}
                className="bg-black border-2 border-green-400 text-green-400 hover:bg-green-400 hover:text-black font-mono px-4 py-2 transition-colors uppercase tracking-wider disabled:opacity-50"
              >
                {loading ? "[TESTING...]" : "[TEST CODE]"}
              </button>

              <button
                onClick={listAllChats}
                disabled={loading}
                className="bg-black border-2 border-yellow-400 text-yellow-400 hover:bg-yellow-400 hover:text-black font-mono px-4 py-2 transition-colors uppercase tracking-wider disabled:opacity-50"
              >
                {loading ? "[LOADING...]" : "[LIST ALL CHATS]"}
              </button>
            </div>

            <div className="bg-gray-900 border border-green-400 p-4 min-h-64 max-h-96 overflow-y-auto">
              {results.length === 0 ? (
                <p className="text-green-600">Enter an invite code and click "TEST CODE" to debug...</p>
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
              <p>{">"} This tool helps debug invite code issues</p>
              <p>{">"} It tests multiple code variations and URL formats</p>
              <p>{">"} Use "LIST ALL CHATS" to see available invite codes</p>
              <p>
                {">"} Current base URL: {getInviteBaseUrl()}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
