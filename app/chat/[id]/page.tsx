"use client"

import type React from "react"

import { useState, useEffect, useRef } from "react"
import { useRouter, useParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { encryptMessage, decryptMessage } from "@/lib/encryption"
import { getInviteBaseUrl } from "@/lib/constants"
import type { Database } from "@/lib/supabase/types"
import { TerminalInput } from "@/components/terminal-input"

type Message = {
  id: string
  chat_id: string
  user_id: string
  content: string
  message_type: string
  created_at: string
  username: string
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
  const [sendingMessage, setSendingMessage] = useState(false)
  const [error, setError] = useState("")
  const [copySuccess, setCopySuccess] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const params = useParams()
  const supabase = createClient()
  const [connectionStatus, setConnectionStatus] = useState<"connected" | "connecting" | "disconnected">("connected")
  const [retryAttempts, setRetryAttempts] = useState(0)
  const [retryingConnection, setRetryingConnection] = useState(false)

  const loadChat = async (userId: string, chatId: string, retryCount = 0) => {
    try {
      console.log("Loading chat:", { userId, chatId, retryCount })

      // Add delay for retries
      if (retryCount > 0) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * retryCount))
      }

      // Use the secure function to get user's chats
      const { data: userChats, error: functionError } = await supabase.rpc("get_user_chats", {
        input_user_id: userId,
      })

      if (functionError) {
        console.error("Function error:", functionError)

        // Check if it's a network error and retry
        if (functionError.message?.includes("fetch") || functionError.message?.includes("network")) {
          if (retryCount < 3) {
            console.log(`Network error, retrying... (attempt ${retryCount + 1}/3)`)
            return loadChat(userId, chatId, retryCount + 1)
          }
        }

        // Only set error if we've exhausted retries
        if (retryCount >= 3) {
          setError(`Failed to load chat: ${functionError.message}`)
        }
        return
      }

      const chatData = userChats?.find((c) => c.id === chatId)

      if (!chatData) {
        // Try direct database query as fallback
        console.log("Chat not found in function result, trying direct query...")

        try {
          const { data: directChatData, error: directError } = await supabase
            .from("chats")
            .select("*")
            .eq("id", chatId)
            .single()

          if (directError || !directChatData) {
            if (retryCount >= 2) {
              setError("Chat not found or you don't have access to it")
            }
            return
          }

          // Check if user has access to this chat
          const isOwner = directChatData.owner_id === userId
          const { data: participantData } = await supabase
            .from("chat_participants")
            .select("*")
            .eq("chat_id", chatId)
            .eq("user_id", userId)
            .single()

          if (!isOwner && !participantData) {
            if (retryCount >= 2) {
              setError("You don't have permission to access this chat")
            }
            return
          }

          console.log("Chat loaded via direct query:", directChatData.name)
          setChat(directChatData)
          setIsOwner(isOwner)
          // Clear any previous errors on success
          setError("")
          return
        } catch (directErr) {
          console.error("Direct query also failed:", directErr)
          if (retryCount >= 2) {
            setError("Chat not found or you don't have access to it")
          }
          return
        }
      }

      console.log("Chat loaded successfully:", chatData.name)
      setChat({
        id: chatData.id,
        name: chatData.name,
        owner_id: chatData.owner_id,
        invite_code: chatData.invite_code,
        invite_url: chatData.invite_url,
        encryption_key: chatData.encryption_key,
        created_at: chatData.created_at,
        updated_at: chatData.updated_at,
      })
      setIsOwner(chatData.is_owner)
      // Clear any previous errors on success
      setError("")
    } catch (err) {
      console.error("Failed to load chat:", err)

      // Check if it's a network error and retry
      if (err instanceof TypeError && err.message.includes("fetch")) {
        if (retryCount < 3) {
          console.log(`Network error caught, retrying... (attempt ${retryCount + 1}/3)`)
          return loadChat(userId, chatId, retryCount + 1)
        } else {
          setError("Network connection failed. Please check your internet connection and try again.")
          return
        }
      }

      // Only set error if we've exhausted retries
      if (retryCount >= 2) {
        setError(`Failed to load chat: ${err instanceof Error ? err.message : "Unknown error"}`)
      }
    }
  }

  const loadMessages = async (chatId: string, retryCount = 0) => {
    try {
      console.log("Loading messages for chat:", chatId, "retry:", retryCount)

      // Add delay for retries
      if (retryCount > 0) {
        await new Promise((resolve) => setTimeout(resolve, 500 * retryCount))
      }

      try {
        const { data, error } = await supabase.rpc("get_chat_messages", {
          input_chat_id: chatId,
          input_user_id: user?.id,
        })

        if (error) {
          console.error("Function error loading messages:", error)

          // Check if it's a network error and retry
          if (error.message?.includes("fetch") || error.message?.includes("network")) {
            if (retryCount < 2) {
              console.log(`Network error loading messages, retrying... (attempt ${retryCount + 1}/2)`)
              return loadMessages(chatId, retryCount + 1)
            }
          }

          // Don't fail the whole chat for message loading issues
          console.error("Failed to load messages via function, trying direct query...")
          throw error
        }

        console.log("Messages loaded via function:", data?.length || 0)
        setMessages(data || [])
        return
      } catch (funcError) {
        console.log("Function failed for messages, trying direct query:", funcError)

        // Fallback to direct query
        const { data, error } = await supabase
          .from("messages")
          .select(`
        *,
        profiles (username)
      `)
          .eq("chat_id", chatId)
          .order("created_at", { ascending: true })

        if (error) {
          console.error("Direct query error loading messages:", error)

          // Check if it's a network error and retry
          if (error.message?.includes("fetch") && retryCount < 2) {
            console.log(`Network error on direct query, retrying... (attempt ${retryCount + 1}/2)`)
            return loadMessages(chatId, retryCount + 1)
          }

          console.error("Failed to load messages, but continuing...")
          return
        }

        console.log("Messages loaded via direct query:", data?.length || 0)

        // Transform the data to match our expected format
        const transformedMessages = (data || []).map((msg) => ({
          id: msg.id,
          chat_id: msg.chat_id,
          user_id: msg.user_id,
          content: msg.content,
          message_type: msg.message_type,
          created_at: msg.created_at,
          username: msg.profiles?.username || "Unknown",
        }))

        setMessages(transformedMessages)
      }
    } catch (err) {
      console.error("Failed to load messages:", err)

      // Check if it's a network error and retry
      if (err instanceof TypeError && err.message.includes("fetch") && retryCount < 2) {
        console.log(`Network error caught loading messages, retrying... (attempt ${retryCount + 1}/2)`)
        return loadMessages(chatId, retryCount + 1)
      }

      console.error("Message loading failed completely, but continuing with empty messages")
    }
  }

  useEffect(() => {
    const initializeChat = async () => {
      try {
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

        console.log("Chat page - User authenticated:", {
          userId: session.user.id,
          chatId: params.id,
        })

        setUser(session.user)
        setRetryingConnection(true)
        await loadChat(session.user.id, params.id as string)
        setRetryingConnection(false)
        setLoading(false)
      } catch (err) {
        console.error("Chat initialization error:", err)
        setError("Failed to initialize chat. Please check your connection.")
        setRetryingConnection(false)
        setLoading(false)
      }
    }

    initializeChat()
  }, [router, params.id, supabase])

  useEffect(() => {
    if (chat && user) {
      loadMessages(params.id as string)

      // Set up real-time subscription for messages with better error handling
      console.log("Setting up realtime subscription for chat:", params.id)

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
            console.log("New message received via realtime:", payload)

            // Add the new message to the state immediately for better UX
            if (payload.new) {
              const newMessage = payload.new as any

              // Get the username for the new message
              supabase
                .from("profiles")
                .select("username")
                .eq("id", newMessage.user_id)
                .single()
                .then(({ data: profile }) => {
                  const formattedMessage: Message = {
                    id: newMessage.id,
                    chat_id: newMessage.chat_id,
                    user_id: newMessage.user_id,
                    content: newMessage.content,
                    message_type: newMessage.message_type,
                    created_at: newMessage.created_at,
                    username: profile?.username || "Unknown",
                  }

                  // Add to messages if it's not already there
                  setMessages((prev) => {
                    const exists = prev.find((msg) => msg.id === formattedMessage.id)
                    if (exists) return prev
                    return [...prev, formattedMessage]
                  })
                })
            }
          },
        )
        .subscribe((status) => {
          console.log("Realtime subscription status:", status)
          if (status === "SUBSCRIBED") {
            console.log("Successfully subscribed to realtime updates")
          } else if (status === "CHANNEL_ERROR") {
            console.error("Realtime subscription error")
          }
        })

      return () => {
        console.log("Cleaning up realtime subscription")
        supabase.removeChannel(channel)
      }
    }
  }, [chat, user, params.id, supabase])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  useEffect(() => {
    // Monitor connection status
    const handleOnline = () => {
      console.log("Connection restored")
      setConnectionStatus("connected")
      if (chat && user && retryAttempts > 0) {
        console.log("Retrying after connection restored...")
        loadMessages(params.id as string)
        setRetryAttempts(0)
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
  }, [chat, user, retryAttempts, params.id])

  const sendMessage = async () => {
    const messageToSend = newMessage // Declare the variable here
    if (!messageToSend.trim() || !user || !chat || sendingMessage) return

    setSendingMessage(true)
    setError("")

    try {
      const encryptedContent = encryptMessage(messageToSend, chat.encryption_key)

      console.log("Sending message:", {
        chatId: chat.id,
        userId: user.id,
        messageLength: messageToSend.length,
      })

      // Clear the input immediately for better UX
      setNewMessage("")

      // Use direct insert - simpler and more reliable
      const { data: insertedMessage, error: insertError } = await supabase
        .from("messages")
        .insert({
          chat_id: chat.id,
          user_id: user.id,
          content: encryptedContent,
          message_type: "text",
        })
        .select(`
        *,
        profiles!inner(username)
      `)
        .single()

      if (insertError) {
        console.error("Direct insert error:", insertError)
        setNewMessage(messageToSend) // Restore message on error
        setError(`Failed to send message: ${insertError.message}`)
        return
      }

      console.log("Message sent successfully:", insertedMessage)

      // Add the message to local state immediately (don't wait for real-time)
      const newMsg: Message = {
        id: insertedMessage.id,
        chat_id: insertedMessage.chat_id,
        user_id: insertedMessage.user_id,
        content: insertedMessage.content,
        message_type: insertedMessage.message_type,
        created_at: insertedMessage.created_at,
        username: insertedMessage.profiles?.username || user.user_metadata?.username || "You",
      }

      setMessages((prev) => {
        // Check if message already exists to prevent duplicates
        const exists = prev.find((msg) => msg.id === newMsg.id)
        if (exists) return prev
        return [...prev, newMsg]
      })
    } catch (err) {
      console.error("Failed to send message:", err)
      setNewMessage(messageToSend) // Restore message on error
      if (err instanceof TypeError && err.message.includes("fetch")) {
        setError("Network connection failed. Please check your internet and try again.")
      } else {
        setError("Failed to send message. Please try again.")
      }
    } finally {
      setSendingMessage(false)
    }
  }

  const sendAsciiEmoji = async (emoji: string) => {
    if (!user || !chat || sendingMessage) return

    setSendingMessage(true)
    setError("")

    try {
      const emojiContent = ASCII_EMOJIS[emoji as keyof typeof ASCII_EMOJIS]
      const encryptedContent = encryptMessage(emojiContent, chat.encryption_key)

      console.log("Sending ASCII emoji:", emoji)

      // Use direct insert
      const { data: insertedMessage, error: insertError } = await supabase
        .from("messages")
        .insert({
          chat_id: chat.id,
          user_id: user.id,
          content: encryptedContent,
          message_type: "ascii",
        })
        .select(`
        *,
        profiles!inner(username)
      `)
        .single()

      if (insertError) {
        console.error("ASCII insert error:", insertError)
        setError(`Failed to send emoji: ${insertError.message}`)
        return
      }

      console.log("ASCII emoji sent successfully:", insertedMessage)

      // Add the message to local state immediately
      const newMsg: Message = {
        id: insertedMessage.id,
        chat_id: insertedMessage.chat_id,
        user_id: insertedMessage.user_id,
        content: insertedMessage.content,
        message_type: insertedMessage.message_type,
        created_at: insertedMessage.created_at,
        username: insertedMessage.profiles?.username || user.user_metadata?.username || "You",
      }

      setMessages((prev) => {
        const exists = prev.find((msg) => msg.id === newMsg.id)
        if (exists) return prev
        return [...prev, newMsg]
      })

      setShowAsciiMenu(false)
    } catch (err) {
      console.error("Failed to send emoji:", err)
      setError("Failed to send emoji. Please try again.")
    } finally {
      setSendingMessage(false)
    }
  }

  const renameChat = async () => {
    if (!newChatName.trim() || !chat || !isOwner) return

    try {
      const { error } = await supabase
        .from("chats")
        .update({ name: newChatName + ".chat" })
        .eq("id", chat.id)

      if (error) {
        console.error("Rename error:", error)
        setError(`Failed to rename chat: ${error.message}`)
        return
      }

      setChat({ ...chat, name: newChatName + ".chat" })
      setNewChatName("")
      setIsRenaming(false)
    } catch (err) {
      console.error("Failed to rename chat:", err)
      setError("Failed to rename chat. Please check your connection.")
    }
  }

  const leaveChat = async () => {
    if (!user || !chat || isOwner) return

    try {
      const { error } = await supabase.from("chat_participants").delete().eq("chat_id", chat.id).eq("user_id", user.id)

      if (error) {
        console.error("Leave chat error:", error)
        setError(`Failed to leave chat: ${error.message}`)
        return
      }

      router.push("/terminal")
    } catch (err) {
      console.error("Failed to leave chat:", err)
      setError("Failed to leave chat. Please check your connection.")
    }
  }

  const copyInviteUrl = async () => {
    if (chat?.invite_code) {
      try {
        const inviteUrl = `${getInviteBaseUrl()}/join/${chat.invite_code}`

        // Try multiple methods to copy to clipboard
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(inviteUrl)
        } else {
          // Fallback for older browsers or non-HTTPS
          const textArea = document.createElement("textarea")
          textArea.value = inviteUrl
          textArea.style.position = "fixed"
          textArea.style.left = "-999999px"
          textArea.style.top = "-999999px"
          document.body.appendChild(textArea)
          textArea.focus()
          textArea.select()
          document.execCommand("copy")
          textArea.remove()
        }

        setCopySuccess(true)
        setTimeout(() => setCopySuccess(false), 3000)
        console.log("Copied invite URL:", inviteUrl)

        // Also log the invite code for debugging
        console.log("Invite code:", chat.invite_code)
      } catch (err) {
        console.error("Failed to copy invite URL:", err)

        // Show the URL in an alert as fallback
        const inviteUrl = `${getInviteBaseUrl()}/join/${chat.invite_code}`
        alert(`Copy this invite URL:\n\n${inviteUrl}`)
      }
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const retryLoadChat = async () => {
    if (user) {
      setError("")
      setLoading(true)
      await loadChat(user.id, params.id as string)
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-green-400 font-mono flex items-center justify-center">
        <div className="text-center">
          <p>
            {">"} {retryingConnection ? "CONNECTING TO CHAT..." : "LOADING CHAT..."}
          </p>
          {retryingConnection && <p className="text-xs text-green-600 mt-2">{">"} This may take a moment...</p>}
          <div className="terminal-cursor-block mt-2">█</div>
        </div>
      </div>
    )
  }

  if (error && !chat) {
    return (
      <div className="min-h-screen bg-black text-green-400 font-mono flex items-center justify-center p-4">
        <div className="text-center max-w-2xl">
          <p className="text-red-400 mb-4">
            {">"} ERROR: {error}
          </p>
          <div className="text-xs text-green-600 mb-6">
            <p>
              {">"} Chat ID: {params.id}
            </p>
            <p>
              {">"} User ID: {user?.id}
            </p>
            <p>{">"} This might be due to:</p>
            <p>{">"} - Chat was deleted</p>
            <p>{">"} - You don't have permission to access this chat</p>
            <p>{">"} - Database connection issues</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <button
              onClick={() => router.push("/terminal")}
              className="bg-black border-2 border-green-400 text-green-400 hover:bg-green-400 hover:text-black font-mono px-4 py-2 transition-colors uppercase tracking-wider"
            >
              [BACK TO TERMINAL]
            </button>
            <button
              onClick={retryLoadChat}
              className="bg-black border-2 border-yellow-400 text-yellow-400 hover:bg-yellow-400 hover:text-black font-mono px-4 py-2 transition-colors uppercase tracking-wider"
            >
              [RETRY]
            </button>
          </div>
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
                className={`bg-black border-2 ${
                  copySuccess
                    ? "border-yellow-400 text-yellow-400"
                    : "border-green-400 text-green-400 hover:bg-green-400 hover:text-black"
                } font-mono px-2 sm:px-3 py-1 transition-colors uppercase tracking-wider text-[10px] sm:text-xs`}
              >
                {copySuccess ? "[COPIED!]" : "[COPY]"}
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

        {/* Connection Status Indicator */}
        {connectionStatus !== "connected" && (
          <div className="text-xs sm:text-sm mb-2">
            <div
              className={`p-2 border ${
                connectionStatus === "disconnected"
                  ? "border-red-400 text-red-400 bg-red-900/20"
                  : "border-yellow-400 text-yellow-400 bg-yellow-900/20"
              }`}
            >
              <p>
                {">"} CONNECTION: {connectionStatus.toUpperCase()}
                {connectionStatus === "disconnected" && " - Messages may not send until reconnected"}
              </p>
            </div>
          </div>
        )}

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
              <span>ENCRYPTED CHAT | {messages.length} MESSAGES | REALTIME</span>
            </div>
          </div>

          {/* Messages Area */}
          <div className="flex-1 bg-gray-900 border border-green-400 p-2 sm:p-4 mb-4 overflow-y-auto max-h-64 sm:max-h-96 terminal-scroll">
            <div className="space-y-2">
              {messages.length === 0 ? (
                <div className="text-center text-green-600 py-4 text-xs sm:text-sm">
                  <p>No messages yet. Start the conversation!</p>
                  <div className="terminal-cursor-block mt-2 mx-auto">█</div>
                </div>
              ) : (
                messages.map((message) => {
                  const decryptedContent = decryptMessage(message.content, chat?.encryption_key || "")
                  return (
                    <div key={message.id} className="text-xs sm:text-sm">
                      <div className="flex flex-wrap items-start gap-1 sm:gap-2">
                        <span className="text-green-300">[{new Date(message.created_at).toLocaleTimeString()}]</span>
                        <span className="text-yellow-400">{message.username || "Unknown"}:</span>
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
                      disabled={sendingMessage}
                      className="bg-black border border-green-400 text-green-400 hover:bg-green-400 hover:text-black font-mono text-[10px] sm:text-xs py-1 px-1 sm:px-2 transition-colors uppercase tracking-wider disabled:opacity-50"
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
                disabled={sendingMessage}
              />
              <div className="flex gap-2">
                <button
                  onClick={() => setShowAsciiMenu(!showAsciiMenu)}
                  disabled={sendingMessage}
                  className="flex-1 sm:flex-none bg-black border-2 border-green-400 text-green-400 hover:bg-green-400 hover:text-black font-mono px-3 sm:px-4 py-2 transition-colors uppercase tracking-wider text-xs sm:text-sm disabled:opacity-50"
                >
                  [ASCII]
                </button>
                <button
                  onClick={sendMessage}
                  disabled={sendingMessage || !newMessage.trim()}
                  className="flex-1 sm:flex-none bg-black border-2 border-green-400 text-green-400 hover:bg-green-400 hover:text-black font-mono px-3 sm:px-4 py-2 transition-colors uppercase tracking-wider text-xs sm:text-sm disabled:opacity-50"
                >
                  {sendingMessage ? "[SENDING...]" : "[SEND]"}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Info */}
        <div className="text-[10px] sm:text-xs text-green-600 mt-4 pt-2 border-t border-green-400">
          <p>{">"} Press ENTER to send message | Use ASCII button for emojis</p>
          <p className="break-all">
            {">"} Share code "{chat?.invite_code}" or URL: {getInviteBaseUrl()}/join/{chat?.invite_code}
          </p>
          <p>{">"} All messages are encrypted end-to-end | Real-time updates enabled</p>
        </div>
      </div>
    </div>
  )
}
