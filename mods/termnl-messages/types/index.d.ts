export type Message = {
  id: string
  name: string
  kind: string
  subject: string
  details: string
  at: number
  status: string
}

export type View = { tab: 'inbox' | 'sent'; open: string }

declare module 'claude-code' {
  interface PluginState {
    'termnl-messages': {
      messages: Shaped<Message[]>
      sent: Shaped<Message[]>
      view: Shaped<View>
      error: string
    }
  }
}
