import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Message, View } from '../types'

const PANE = 'termnl-messages'
const TITLE = 'Termnl'
const KIND: Record<string, string> = { request: 'Request', offer: 'Offer', inform: 'For your information' }
const STATUS: Record<string, string> = {
  open: 'Waiting for a reply',
  accepted: 'Agreed',
  committed: 'Agreed and signed by both sides',
  declined: 'Declined',
  countered: 'Change suggested',
}
const HOME: View = { tab: 'inbox', open: '' }

const messages = atom({ plugin: 'termnl-messages', key: 'messages' } as const, [], { shape: 'messages-1' })
const sent = atom({ plugin: 'termnl-messages', key: 'sent' } as const, [], { shape: 'sent-1' })
const view = atom({ plugin: 'termnl-messages', key: 'view' } as const, HOME, { shape: 'view-1' })
const error = atom({ plugin: 'termnl-messages', key: 'error' } as const, '')

// Reads the profile's files directly: read-only, so it never races the Termnl plugin's writes.
const load = async ($: EngineInterface) => {
  try {
    const { stdout } = await $.process.run(['sh', '-c', 'printf %s "${TERMNL_HOME:-$HOME/.termnl}"'])
    const file = async (name: string) => JSON.parse(await $.fs.read(`${stdout}/${name}`))
    const contacts = await file('contacts.json')
    const names = new Map<string, string>(contacts.map((c: any) => [c.identity, c.name]))
    const shape = (who: 'from' | 'to', at: 'received_at' | 'sent_at') => (m: any): Message => ({
      id: String(m.id),
      name: names.get(m[who]) ?? 'Unknown contact',
      kind: String(m.body?.kind ?? ''),
      subject: String(m.body?.subject ?? ''),
      details: String(m.body?.details ?? ''),
      at: Number(m[at]) * 1000,
      status: String(m.status),
    })
    const newest = (a: Message, b: Message) => b.at - a.at
    const inbox: Message[] = (await file('inbox.json')).map(shape('from', 'received_at')).sort(newest)
    const outbox: Message[] = (await file('outbox.json').catch(() => [])).map(shape('to', 'sent_at')).sort(newest)
    await update($, messages, () => inbox)
    await update($, sent, () => outbox)
    await update($, error, () => '')
  } catch {
    await update($, error, () => 'No Termnl profile found. Run "npx -y termnl init" first.')
  }
}

// ponytail: sync shares the profile with the Termnl plugin and the file store has no lock;
// every two minutes keeps overlap rare. Add a lock in the CLI if writes ever collide.
const sync = async ($: EngineInterface) => {
  await $.process.run(['npx', '-y', 'termnl', 'sync'], { timeoutMs: 60000 }).catch(() => undefined)
  await load($)
}

const clock = (at: number, long = false) => {
  const d = new Date(at)
  const time = d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })
  const day = d.toLocaleDateString('en-AU', { weekday: long ? 'short' : undefined, day: 'numeric', month: 'short' })
  if (long) return `${day}, ${time}`

  return d.toDateString() === new Date().toDateString() ? time : day
}

const clip = (text: string, width: number) => {
  const line = text.replace(/\s+/g, ' ').trim()

  return line.length > width ? `${line.slice(0, Math.max(1, width - 1))}…` : line
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'termnl', description: 'Show your Termnl messages in a panel' })
    void $.ui.open({ id: PANE, title: TITLE })
    void load($)
    $.clock.every(120000, () => void sync($))

    return next(e)
  })

  on('command.run', { command: 'termnl' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    await sync($)

    return { text: 'Termnl panel opened.' }
  })

  // The panel catches up as soon as the agent answers or sends something.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (e.tool.startsWith('mcp__termnl__')) void load($)

    return ran
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const inbox = await read($, messages)
    const outbox = await read($, sent)
    const now = await read($, view)
    const problem = await read($, error)
    const width = Math.max(24, (e.props.bodyColumns ?? 44) - 4)
    const isSent = now.tab === 'sent'
    const list = isSent ? outbox : inbox
    const unread = inbox.filter(m => m.status === 'open').length
    const go = (to: View) => () => void update($, view, () => to)
    const opened = list.find(m => m.id === now.open)
    // Buttons ask the agent, naming the request id only, so the mandate still applies
    // and the other party's text is never replayed as the owner's words.
    const ask = (verb: string, id: string) => () => {
      void $.prompt.submit({ text: `${verb} Termnl request ${id}`, asUser: true })
      void $.ui.toast(`Asked your agent to ${verb.toLowerCase()} it`)
    }

    if (opened) {
      return (
        <Box flexDirection="column">
          <Button key="back" role="dismiss" onPress={go({ tab: now.tab, open: '' })}>
            ‹ {isSent ? 'Sent' : 'Inbox'}
          </Button>
          <Box flexDirection="column" marginTop={1}>
            <Text bold>{opened.subject}</Text>
            <Text>{isSent ? 'To' : 'From'} {opened.name}</Text>
            <Text dimColor>{clock(opened.at, true)} · {KIND[opened.kind] ?? opened.kind}</Text>
            <Text dimColor>{STATUS[opened.status] ?? opened.status}</Text>
          </Box>
          <Box marginTop={1}>
            <Text>{opened.details === '' ? '(No further details.)' : opened.details}</Text>
          </Box>
          {!isSent && opened.status === 'open' && (
            <Box flexDirection="row" gap={1} marginTop={1}>
              <Button key="accept" variant="primary" onPress={ask('Accept', opened.id)}>
                {opened.kind === 'inform' ? 'Acknowledge' : 'Accept'}
              </Button>
              <Button key="decline" onPress={ask('Decline', opened.id)}>Decline</Button>
              <Button
                key="counter"
                onPress={() => void $.prompt.fill({ text: `Suggest a change to Termnl request ${opened.id}: ` })}
              >
                Suggest a change
              </Button>
            </Box>
          )}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Button key="inbox" variant={isSent ? undefined : 'primary'} onPress={go(HOME)}>
            Inbox{unread ? ` (${unread})` : ''}
          </Button>
          <Button key="sent" variant={isSent ? 'primary' : undefined} onPress={go({ tab: 'sent', open: '' })}>
            Sent
          </Button>
          <Button key="refresh" onPress={() => void sync($)}>Refresh</Button>
        </Box>
        {problem !== '' && <Text dimColor>{problem}</Text>}
        {problem === '' && list.length === 0 && (
          <Box marginTop={1}>
            <Text dimColor>{isSent ? 'Nothing sent yet.' : 'No messages yet.'}</Text>
          </Box>
        )}
        {list.map(m => {
          const isNew = !isSent && m.status === 'open'

          return (
            <Box flexDirection="column" marginTop={1}>
              <Button key={m.id} onPress={go({ tab: now.tab, open: m.id })}>
                {isNew ? '● ' : '  '}
                {isSent ? `To ${m.name}` : m.name} <Text dimColor>{clock(m.at)}</Text>
              </Button>
              <Text bold={isNew} dimColor={!isNew}>{'  '}{clip(m.subject, width)}</Text>
              {m.details !== '' && <Text dimColor>{'  '}{clip(m.details, width)}</Text>}
            </Box>
          )
        })}
      </Box>
    )
  })
}
