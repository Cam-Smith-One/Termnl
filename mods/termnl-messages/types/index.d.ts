export type Message = {
  id: string
  name: string
  kind: string
  subject: string
  details: string
  at: number
  status: string
  /** Names of people the viewer has paired with who also got it; empty when none. */
  also: string
  /** Extra lines for the reading view: what it replies to, the team, and any receipt. */
  notes: string[]
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
