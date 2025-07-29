"use client"

import type React from "react"

import { useState, useEffect, useRef } from "react"
import { useRouter, useParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { encryptMessage, decryptMessage } from "@/lib/encryption"
import type { Database } from "@/lib/supabase/types"
import { TerminalInput } from "@/components/terminal-input"

type Message = Database["public"]["Tables"]["messages"]["Row"] & {
  profiles: {
    username: string
  }
}

type Chat = Database["public"]["Tables"]["chats"]["Row"]

const ASCII_EMOJIS = {
  smile: `   :-)   `,
  laugh: `   :-D   `,
  heart: `    <3   `,
  thumbsup: `   _\n  | |\n  |_|\n   ^   `,
  sad: `   :-(   `,
  wink: `   ;-)   `,
  kiss: `   :-*   `,
  angry: `  >:-(   `,
  surprised: `   :-O   `,
  cool: `   8-)   `,
}

export default function ChatPage() {
  const [user, setUser] = useState<any>(null)
  const [chat, setChat] = useState<Chat | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [newMessage, setNewMessage] = useState("")
  const [isOwner, setIsOwner] = useState(false)
  const [isRenaming, setIsRenaming] = useState(false)
  const [newChatName, setNewChatName] = useState("")
  const [showAsciiMenu, setShowAsciiMenu] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const params = useParams()
  const supabase = createClient()

  useEffect(() => {
    const initializeChat = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      const isEmailVerified =
        session?.user?.email_confirmed_at ||
        session?.user?.confirmed_at ||
        session?.user?.user_metadata?.email_verified === true ||
        session?.user?.app_metadata?.email_verified === true

      if (!session?.user || !isEmailVerified) {
        router.push("/")
        return
      }

      setUser(session.user)
      await loadChat(session.user.id, params.id as string)
      await loadMessages(params.id as string)
      setLoading(false)

      // Set up real-time subscription for messages
      const channel = supabase
        .channel(`chat-${params.id}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "messages",
            filter: `chat_id=eq.${params.id}`,
          },
          (payload) => {
            loadMessages(params.id as string)
          },
        )
        .subscribe()

      return () => {
        supabase.removeChannel(channel)
      }
    }

    initializeChat()
  }, [router, params.id, supabase])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const loadChat = async (userId: string, chatId: string) => {
    try {
      const { data, error } = await supabase.from("chats").select("*").eq("id", chatId).single()

      if (error || !data) {
        setError("Chat not found")
        return
      }

      // Check if user has access to this chat
      const isOwner = data.owner_id === userId
      const { data: participant } = await supabase
        .from("chat_participants")
        .select("*")
        .eq("chat_id", chatId)
        .eq("user_id", userId)
        .single()

      if (!isOwner && !participant) {
        setError("Access denied")
        return
      }

      setChat(data)
      setIsOwner(isOwner)
    } catch (err) {
      setError("Failed to load chat")
    }
  }

  const loadMessages = async (chatId: string) => {
    try {
      const { data, error } = await supabase
        .from("messages")
        .select(`
          *,
          profiles (username)
        `)
        .eq("chat_id", chatId)
        .order("created_at", { ascending: true })

      if (error) throw error

      setMessages(data || [])
    } catch (err) {
      setError("Failed to load messages")
    }
  }

  const sendMessage = async () => {
    if (!newMessage.trim() || !user || !chat) return

    try {
      const encryptedContent = encryptMessage(newMessage, chat.encryption_key)

      const { error } = await supabase.from("messages").insert({
        chat_id: chat.id,
        user_id: user.id,
        content: encryptedContent,
        message_type: "text",
      })

      if (error) throw error

      setNewMessage("")
    } catch (err) {
      setError("Failed to send message")
    }
  }

  const sendAsciiEmoji = async (emoji: string) => {
    if (!user || !chat) return

    try {
      const emojiContent = ASCII_EMOJIS[emoji as keyof typeof ASCII_EMOJIS]
      const encryptedContent = encryptMessage(emojiContent, chat.encryption_key)

      const { error } = await supabase.from("messages").insert({
        chat_id: chat.id,
        user_id: user.id,
        content: encryptedContent,
        message_type: "ascii",
      })

      if (error) throw error

      setShowAsciiMenu(false)
    } catch (err) {
      setError("Failed to send emoji")
    }
  }

  const renameChat = async () => {
    if (!newChatName.trim() || !chat || !isOwner) return

    try {
      const { error } = await supabase
        .from("chats")
        .update({ name: newChatName + ".chat" })
        .eq("id", chat.id)

      if (error) throw error

      setChat({ ...chat, name: newChatName + ".chat" })
      setNewChatName("")
      setIsRenaming(false)
    } catch (err) {
      setError("Failed to rename chat")
    }
  }

  const leaveChat = async () => {
    if (!user || !chat || isOwner) return

    try {
      const { error } = await supabase.from("chat_participants").delete().eq("chat_id", chat.id).eq("user_id", user.id)

      if (error) throw error

      router.push("/terminal")
    } catch (err) {
      setError("Failed to leave chat")
    }
  }

  const copyInviteUrl = () => {
    if (chat?.invite_url) {
      navigator.clipboard.writeText(chat.invite_url)
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-green-400 font-mono flex items-center justify-center">
        <div className="text-center">
          <p>{">"} LOADING CHAT...</p>
          <div className="animate-pulse mt-2">█</div>
        </div>
      </div>
    )
  }

  if (error && !chat) {
    return (
      <div className="min-h-screen bg-black text-green-400 font-mono flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400">
            {">"} ERROR: {error}
          </p>
          <button
            onClick={() => router.push("/terminal")}
            className="mt-4 bg-black border-2 border-green-400 text-green-400 hover:bg-green-400 hover:text-black font-mono px-4 py-2 transition-colors uppercase tracking-wider"
          >
            [BACK TO TERMINAL]
          </button>
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
              <span className="ml-2 sm:ml-4 text-xs sm:text-sm truncate">TERMNL - {chat?.name}</span>
            </div>
            <div className="flex items-center gap-1 sm:gap-4 text-xs sm:text-sm">
              <span className="hidden sm:inline">INVITE: {chat?.invite_code}</span>
              <button
                onClick={copyInviteUrl}
                className="bg-black border-2 border-green-400 text-green-400 hover:bg-green-400 hover:text-black font-mono px-2 sm:px-3 py-1 transition-colors uppercase tracking-wider text-[10px] sm:text-xs"
              >
                [COPY]
              </button>
              {isOwner ? (
                <span className="text-yellow-400 font-mono text-[10px] sm:text-xs">[OWNER]</span>
              ) : (
                <button
                  onClick={leaveChat}
                  className="bg-black border-2 border-red-400 text-red-400 hover:bg-red-400 hover:text-black font-mono px-2 sm:px-3 py-1 transition-colors uppercase tracking-wider text-[10px] sm:text-xs"
                >
                  [LEAVE]
                </button>
              )}
              <button
                onClick={() => router.push("/terminal")}
                className="bg-black border-2 border-yellow-400 text-yellow-400 hover:bg-yellow-400 hover:text-black font-mono px-2 sm:px-3 py-1 transition-colors uppercase tracking-wider text-[10px] sm:text-xs"
              >
                [BACK]
              </button>
            </div>
          </div>
        </div>

        {/* Chat Interface */}
        <div className="bg-black border-green-400 border-t-0 rounded-t-none border p-3 sm:p-6 min-h-[600px] flex flex-col">
          {error && (
            <div className="text-red-400 text-xs sm:text-sm p-2 sm:p-3 border border-red-400 bg-gray-900 mb-4">
              <p>
                {">"} ERROR: {error}
              </p>
              <button
                onClick={() => setError("")}
                className="mt-2 bg-black border border-red-400 text-red-400 hover:bg-red-400 hover:text-black font-mono px-2 py-1 text-xs"
              >
                [DISMISS]
              </button>
            </div>
          )}

          {/* Chat Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 pb-2 border-b border-green-400 gap-2">
            <div className="flex items-center gap-2 sm:gap-4">
              {isRenaming && isOwner ? (
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
                  <TerminalInput
                    type="text"
                    value={newChatName}
                    onChange={(e) => setNewChatName(e.target.value)}
                    placeholder="New chat name..."
                    className="w-full sm:w-48 p-1"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={renameChat}
                      className="bg-black border-2 border-green-400 text-green-400 hover:bg-green-400 hover:text-black font-mono px-2 sm:px-3 py-1 transition-colors uppercase tracking-wider text-[10px] sm:text-xs"
                    >
                      [SAVE]
                    </button>
                    <button
                      onClick={() => setIsRenaming(false)}
                      className="bg-black border-2 border-red-400 text-red-400 hover:bg-red-400 hover:text-black font-mono px-2 sm:px-3 py-1 transition-colors uppercase tracking-wider text-[10px] sm:text-xs"
                    >
                      [CANCEL]
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                  <h2 className="text-sm sm:text-lg">
                    {">"} {chat?.name}
                  </h2>
                  {isOwner && (
                    <button
                      onClick={() => setIsRenaming(true)}
                      className="self-start bg-black border-2 border-green-400 text-green-400 hover:bg-green-400 hover:text-black font-mono px-2 sm:px-3 py-1 transition-colors uppercase tracking-wider text-[10px] sm:text-xs"
                    >
                      [RENAME]
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="text-xs sm:text-sm">
              <span>ENCRYPTED CHAT</span>
            </div>
          </div>

          {/* Messages Area */}
          <div className="flex-1 bg-gray-900 border border-green-400 p-2 sm:p-4 mb-4 overflow-y-auto max-h-64 sm:max-h-96">
            <div className="space-y-2">
              {messages.length === 0 ? (
                <div className="text-center text-green-600 py-4 text-xs sm:text-sm">
                  No messages yet. Start the conversation!
                </div>
              ) : (
                messages.map((message) => {
                  const decryptedContent = decryptMessage(message.content, chat?.encryption_key || "")
                  return (
                    <div key={message.id} className="text-xs sm:text-sm">
                      <div className="flex flex-wrap items-start gap-1 sm:gap-2">
                        <span className="text-green-300">[{new Date(message.created_at).toLocaleTimeString()}]</span>
                        <span className="text-yellow-400">{message.profiles?.username || "Unknown"}:</span>
                      </div>
                      {message.message_type === "ascii" ? (
                        <pre className="text-green-400 ml-2 sm:ml-4 text-[10px] sm:text-xs leading-tight whitespace-pre-wrap overflow-x-auto">
                          {decryptedContent}
                        </pre>
                      ) : (
                        <div className="text-green-400 ml-2 sm:ml-4 break-words">{decryptedContent}</div>
                      )}
                    </div>
                  )
                })
              )}
              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Input Area */}
          <div className="space-y-3">
            {/* ASCII Menu */}
            {showAsciiMenu && (
              <div className="bg-gray-900 border border-green-400 p-2 sm:p-3 text-green-400">
                <p className="text-xs sm:text-sm mb-2">{">"} SELECT ASCII EMOJI:</p>
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-1">
                  {Object.keys(ASCII_EMOJIS).map((emoji) => (
                    <button
                      key={emoji}
                      onClick={() => sendAsciiEmoji(emoji)}
                      className="bg-black border border-green-400 text-green-400 hover:bg-green-400 hover:text-black font-mono text-[10px] sm:text-xs py-1 px-1 sm:px-2 transition-colors uppercase tracking-wider"
                    >
                      [{emoji}]
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Message Input */}
            <div className="flex flex-col sm:flex-row gap-2">
              <TerminalInput
                type="text"
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Type your message..."
                className="flex-1 p-2"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => setShowAsciiMenu(!showAsciiMenu)}
                  className="flex-1 sm:flex-none bg-black border-2 border-green-400 text-green-400 hover:bg-green-400 hover:text-black font-mono px-3 sm:px-4 py-2 transition-colors uppercase tracking-wider text-xs sm:text-sm"
                >
                  [ASCII]
                </button>
                <button
                  onClick={sendMessage}
                  className="flex-1 sm:flex-none bg-black border-2 border-green-400 text-green-400 hover:bg-green-400 hover:text-black font-mono px-3 sm:px-4 py-2 transition-colors uppercase tracking-wider text-xs sm:text-sm"
                >
                  [SEND]
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Info */}
        <div className="text-[10px] sm:text-xs text-green-600 mt-4 pt-2 border-t border-green-400">
          <p>{">"} Press ENTER to send message | Use ASCII button for emojis</p>
          <p className="break-all">
            {">"} Share code "{chat?.invite_code}" to invite others
          </p>
          <p>{">"} All messages are encrypted end-to-end</p>
        </div>
      </div>
    </div>
  )
}
