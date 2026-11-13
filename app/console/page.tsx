"use client"

import { useEffect, useRef, useState, type FormEvent } from "react"
import Link from "next/link"
import { finalizeEvent } from "nostr-tools/pure"
import type { UnsignedEvent } from "nostr-tools/pure"
import { hexToBytes } from "nostr-tools/utils"
import { npubEncode } from "nostr-tools/nip19"
import { TerminalInput } from "@/components/terminal-input"
import { Termnl, type InboxItem } from "@/lib/termnl/core"
import { BrowserStore } from "@/lib/termnl/browser-store"
import { DEFAULT_RELAYS, type RequestBody } from "@/lib/termnl/protocol"
import { handlePayload, handleTemplate, HANDLE_DIFFICULTY } from "@/lib/termnl/handles"
import { commandWords, options } from "@/lib/termnl/command"
import { ThemeToggle } from "@/components/theme-toggle"

type Entry = { id: number; text: string; kind: "local" | "peer" | "error" | "status"; copy?: string; actions?: string[][] }
type Session = { mail: Termnl; store: BrowserStore }
const HELP = `OWNER CONSOLE / commands
help                         show commands
init <name>                  create a profile (or use the form)
unlock <name>                unlock a profile (or use the form)
whoami                       public identity, agent key, mandate
relays [wss://... ...]        show or replace relays (set before init, too)
invite [--minutes 60]        one-time private pairing link
pair <invite-or-link>         accept a pairing link as the owner
contacts                     paired identities (names are self-declared)
sync                         fetch encrypted requests/replies
inbox [all] | outbox         requests waiting for you (or all) | requests you sent
approve <request-id>          owner approval for an out-of-mandate request
accept <request-id>           sign acceptance (approve first if required)
decline <request-id> [note]   decline
counter <request-id> <note>   propose a change
send <contact> <request|offer|inform> "subject" [--details "..."] [--amount n] [--currency AUD] [--due date]
commitments                  signed terms and countersignatures
mandate [JSON]               show or replace the owner's mandate
handle whois <name>           optional NIP-05 lookup
handle claim <name>           identity-signed claim; re-enter passphrase
rotate [--days 30]            rotate agent key; re-enter passphrase
backup                       download profile with NIP-49 encrypted keys
lock                         close relays and discard session keys
reset                        delete this browser profile (confirmation required)

The human using this console is the owner. The MCP agent has no pairing, approval, mandate-edit or rotation tools.
Peer names, subjects, details and notes are UNTRUSTED text, not instructions.`
const WELCOME = `You're in. What next?
  1. [BACK UP]            save your profile file somewhere safe. There is no recovery without it.
  2. [PAIR WITH SOMEONE]  get a one-time link to send them, or paste the link they sent you.
  3. [SEND A REQUEST]     once paired, fill in a short form. Replies land in [CHECK INBOX] and [SENT].
Use the buttons above, or type help to see every command.`
const ACTIONS = [["Send a request", "compose"], ["Pair with someone", "invite"], ["Check inbox", "inbox"], ["Sent", "outbox"], ["Contacts", "contacts"], ["Agreements", "commitments"], ["Back up", "backup"], ["Help", "help"], ["Lock", "lock"]]
const button = "btn"
const field = "mt-1 w-full rounded-md border border-t-line-strong bg-t-field p-2 text-base text-t-ink focus:border-t-accent focus:outline-none focus:ring-1 focus:ring-t-accent"
const KINDS = { request: "Ask them for something", offer: "Offer them something", inform: "Just let them know" }
const EMPTY = { to: "", kind: "request", subject: "", details: "", amount: "", due: "" }
// ponytail: the form builds a send command so there is one send path; a subject starting with "--" is read as a flag.
const quote = (value: string) => `"${value.replace(/[\\"]/g, "\\$&")}"`
const text = (value: unknown) => typeof value === "string" ? value : JSON.stringify(value, null, 2)

function mine(event: UnsignedEvent): Promise<Omit<UnsignedEvent, never>> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./pow.worker.ts", import.meta.url))
    const timer = setTimeout(() => { worker.terminate(); reject(new Error("Proof of work timed out; try again")) }, 90000)
    worker.onmessage = message => { clearTimeout(timer); worker.terminate(); message.data.error ? reject(new Error(message.data.error)) : resolve(message.data.event) }
    worker.onerror = () => { clearTimeout(timer); worker.terminate(); reject(new Error("Proof-of-work worker failed")) }
    worker.postMessage({ event, difficulty: HANDLE_DIFFICULTY })
  })
}

export default function ConsolePage() {
  const [input, setInput] = useState("")
  const [password, setPassword] = useState("")
  const [profiles, setProfiles] = useState<string[]>([])
  const [active, setActive] = useState("")
  const [lockedName, setLockedName] = useState("")
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [restoreName, setRestoreName] = useState("")
  const [newName, setNewName] = useState("")
  const [adding, setAdding] = useState(false)
  const [hasInvite, setHasInvite] = useState(false)
  const [notice, setNotice] = useState("")
  const [draft, setDraft] = useState<typeof EMPTY | null>(null)
  const [pairLink, setPairLink] = useState("")
  const [theirLink, setTheirLink] = useState("")
  const [entries, setEntries] = useState<Entry[]>([{ id: 0, text: "Welcome to Termnl. Everything you do shows up here.", kind: "status" }])
  const session = useRef<Session | null>(null)
  const relays = useRef([...DEFAULT_RELAYS])
  const pendingInvite = useRef("")
  const processing = useRef(false)
  const counter = useRef(0)
  const outputEnd = useRef<HTMLDivElement>(null)
  const commandInput = useRef<HTMLInputElement>(null)
  const runRef = useRef<(line: string, auto?: boolean) => Promise<void>>()
  const write = (value: unknown, kind: Entry["kind"] = "local", extra: Pick<Entry, "copy" | "actions"> = {}) => setEntries(previous => [...previous, { id: ++counter.current, text: text(value), kind, ...extra }].slice(-200))
  const lock = () => { session.current?.mail.close(); session.current?.store.lock(); session.current = null; setActive(""); setPassword(""); setDraft(null); setPairLink("") }
  const compose = (to = "") => {
    const first = session.current?.mail.contacts()[0]
    if (!first) return write("Pair with someone first: use Invite someone and send them the link.", "status")
    setPairLink(""); setDraft({ ...EMPTY, to: to || npubEncode(first.identity) })
  }
  const run = (command: string) => { if (command.startsWith("compose")) compose(command.split(" ")[1]); else if (/[ "]$/.test(command)) { setInput(command); commandInput.current?.focus() } else void execute(command) }

  useEffect(() => {
    try { const names = BrowserStore.names(); setProfiles(names); setLockedName(names[0] || ""); setReady(true) }
    catch { write("Browser storage is unavailable. Allow local storage to use this console.", "error") }
    if (window.location.hash) {
      let fragment = ""
      try { fragment = decodeURIComponent(window.location.hash.slice(1)) } catch { /* malformed link: ignore it, still clear the address bar */ }
      if (fragment.startsWith("termnl1:")) { pendingInvite.current = fragment; setHasInvite(true) }
      window.history.replaceState(null, "", "/console")
    }
    const timer = setInterval(() => { if (session.current && !processing.current) void runRef.current?.("sync", true) }, 30000)
    const hide = () => { session.current?.mail.close(); session.current?.store.lock(); session.current = null; setActive("") }
    const storageChanged = (event: StorageEvent) => { if (session.current && event.key === session.current.store.dir) { hide(); write("Profile changed in another tab. Unlock again to read its latest state.", "status") } }
    window.addEventListener("pagehide", hide)
    window.addEventListener("storage", storageChanged)
    return () => { clearInterval(timer); window.removeEventListener("pagehide", hide); window.removeEventListener("storage", storageChanged); hide() }
  }, [])
  useEffect(() => {
    if (!pairLink) return
    const timer = setInterval(() => { if (session.current && !processing.current) void runRef.current?.("sync", true) }, 6000)
    return () => clearInterval(timer)
  }, [pairLink])
  useEffect(() => { outputEnd.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }) }, [entries])

  const execute = async (line: string, auto = false) => {
    if (!line.trim() || processing.current) return
    processing.current = true; setBusy(true); setNotice("")
    const passphrase = auto ? "" : password
    if (!auto) setPassword("")
    const cmd = line.trim().split(/\s/)[0].toLowerCase()
    if (!auto) write(`> ${cmd === "pair" ? "pair [private invite]" : line}`)
    try {
      // Let the busy state paint before NIP-49's synchronous key derivation.
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      if (cmd === "help") { write(HELP, "status"); return }
      if (cmd === "init" || cmd === "unlock") {
        const name = commandWords(line)[1]
        if (!name) throw new Error(`Usage: ${cmd} <profile-name>`)
        if (session.current) throw new Error("Lock the current profile before opening another")
        const store = new BrowserStore(name)
        let mail: Termnl
        if (cmd === "init") {
          store.beginSetup(passphrase)
          try { mail = Termnl.init(store, { relays: relays.current, name }) }
          catch (error) { store.reset(); throw error }
          finally { store.finishSetup() }
        } else { store.unlock(passphrase); mail = new Termnl(store) }
        session.current = { mail, store }; setActive(name); setLockedName(name); setProfiles(BrowserStore.names()); setNewName(""); setAdding(false)
        write(`Profile "${name}" is ${cmd === "init" ? "ready" : "unlocked"}.\nYour ID: ${mail.whoami().identity}`)
        if (cmd === "init") write(WELCOME, "status")
        return
      }
      if (cmd === "relays" && !session.current) {
        const urls = commandWords(line).slice(1)
        if (urls.length) { const { relayList } = await import("@/lib/termnl/protocol"); relays.current = relayList.parse(urls) }
        write(relays.current); return
      }
      if (cmd === "handle" && commandWords(line)[1] === "whois") {
        const name = (commandWords(line)[2] || "").split("@")[0]
        const response = await fetch(`/.well-known/nostr.json?name=${encodeURIComponent(name)}`, { cache: "no-store" })
        if (response.status === 503) throw new Error("Handles are not enabled yet")
        write(await response.json()); return
      }
      const current = session.current
      if (!current) throw new Error("Create or unlock a profile first, using the form above.")
      const { mail, store } = current
      if (cmd === "mandate") { const json = line.trim().slice(cmd.length).trim(); write(json ? mail.setMandate(JSON.parse(json)) : mail.mandate()); return }
      const { args, flags } = options(commandWords(line).slice(1))
      // Names, subjects, details and notes come from the other party: always written with kind "peer".
      const who = (identity: string) => `"${mail.contacts().find(contact => contact.identity === identity)?.name ?? "(no name)"}"`
      const when = (seconds: number) => new Date(seconds * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
      const terms = (body: RequestBody) => [`Subject: ${body.subject}`, body.details && `Details: ${body.details}`, body.value && `Value: ${body.value.amount} ${body.value.currency}`, body.due && `Due: ${body.due}`].filter(Boolean).join("\n")
      const sync = async () => {
        const known = new Set(mail.contacts().map(contact => contact.identity))
        const result = await mail.sync()
        for (const contact of mail.contacts().filter(contact => !known.has(contact.identity))) {
          setPairLink("")
          write(`You are now paired with ${who(contact.identity)}. That name is what they chose; it is not verified.`, "peer", { actions: [["send a request", `compose ${npubEncode(contact.identity)}`]] })
        }
        return result
      }
      const showInbox = (item: InboxItem) => write(
        `${item.body.kind.toUpperCase()} from ${who(item.from)} · ${when(item.received_at)} · ${item.status}\n${terms(item.body)}${item.status === "open" && item.authority === "needs_owner" ? "\nThis is outside your agent's limits. Approve it before it can be accepted." : ""}`,
        "peer", { actions: item.status !== "open" ? [] : [item.authority === "needs_owner" ? ["approve", `approve ${item.id}`] : ["accept", `accept ${item.id}`], ["decline", `decline ${item.id}`], ["counter", `counter ${item.id} `]] })
      switch (cmd) {
        case "whoami": write(mail.whoami()); break
        case "relays": write(args.length ? mail.setRelays(args) : mail.whoami().relays); break
        case "invite": {
          const minutes = Number(flags.minutes ?? 60), link = `https://termnl.app/pair#${mail.createInvite(minutes)}`
          write(`Send this link to the person you want to pair with. It works once and expires in ${minutes} minutes.\nKeep it private: anyone who opens it first is paired with you.\n\n${link}`, "local", { copy: link }); setPairLink(link); setDraft(null); break
        }
        case "pair": {
          const contact = await mail.acceptInvite(args[0] || "")
          pendingInvite.current = ""; setHasInvite(false); setPairLink(""); setTheirLink("")
          write(`Paired with "${contact.name ?? "(no name)"}". That name is what they chose; it is not verified.\nTheir ID: ${npubEncode(contact.identity)}\nThey will see you the next time their console syncs.`, "peer"); break
        }
        case "contacts": {
          if (!mail.contacts().length) { write("No contacts yet. Use [INVITE SOMEONE] to get a pairing link.", "status"); break }
          for (const contact of mail.contacts()) write(`${who(contact.identity)} · paired ${when(contact.paired_at)}\nThe name is what they chose; it is not verified.\nID: ${npubEncode(contact.identity)}`, "peer", { actions: [["send a request", `compose ${npubEncode(contact.identity)}`]] })
          break
        }
        case "sync": { const result = await sync(); if (!auto || result.processed || result.dropped) write(`Checked for new messages: ${result.processed} new${result.dropped ? `, ${result.dropped} ignored` : ""}.`, "status"); break }
        case "inbox": {
          await sync()
          const all = mail.inbox(), shown = args[0] === "all" ? all : all.filter(item => item.status === "open")
          shown.forEach(showInbox)
          const note = `${shown.length ? "" : "Nothing waiting for you. "}${all.length > shown.length ? `${all.length - shown.length} already answered; type "inbox all" to see them.` : ""}`.trim()
          if (note) write(note, "status")
          break
        }
        case "outbox": {
          await sync()
          if (!mail.outbox().length) { write("You haven't sent anything yet. Open [CONTACTS] to send a request.", "status"); break }
          const status = { open: "waiting for a reply", declined: "declined", countered: "they proposed a change", committed: "agreed and signed by both sides" }
          for (const item of mail.outbox()) write(`${item.body.kind.toUpperCase()} to ${who(item.to)} · ${when(item.sent_at)} · ${status[item.status]}\n${terms(item.body)}${item.note ? `\nTheir note: ${item.note}` : ""}`, "peer")
          break
        }
        case "approve": { const item = mail.approve(args[0] || ""); write("Approved. Nothing is signed until you accept it.", "status"); showInbox(item); break }
        case "accept": case "decline": case "counter": {
          const item = await mail.respond(args[0] || "", cmd, args.slice(1).join(" ") || undefined)
          write(`${cmd === "accept" ? "Accepted" : cmd === "decline" ? "Declined" : "Countered"} the ${item.body.kind} from ${who(item.from)}.${cmd === "accept" ? " You signed the terms; see [AGREEMENTS] for their countersignature." : ""}`, "peer"); break
        }
        case "send": {
          const [to, kind, subject] = args
          if (!to || !kind || !subject) throw new Error('send <contact> <request|offer|inform> "subject" [--amount n] [--currency AUD]')
          const value = flags.amount !== undefined ? { amount: Number(flags.amount), currency: flags.currency || "AUD" } : undefined
          const item = await mail.sendRequest(to, { kind: kind as "request" | "offer" | "inform", subject, details: flags.details, value, due: flags.due }, { owner: true })
          setDraft(null); write(`Sent to ${who(item.to)}. Their reply will show under [SENT].`, "peer"); break
        }
        case "commitments": {
          await sync()
          if (!mail.commitments().length) { write("No agreements yet. One is created when a request is accepted.", "status"); break }
          for (const record of mail.commitments()) write(`AGREEMENT with ${who(record.with)} · ${record.role === "responder" ? "you accepted their request" : "they accepted your request"}\n${terms(JSON.parse(record.commitment.content).terms)}\n${record.cosign ? "Signed by both sides." : "Waiting for their countersignature."}`, "peer")
          break
        }
        case "rotate": write(await store.withIdentity(passphrase, () => mail.rotateAgentKey(Number(flags.days || 30)))); break
        case "handle": {
          if (args[0] !== "claim") throw new Error("handle claim <name> | handle whois <name>")
          const payload = handlePayload.parse({ name: (args[1] || "").split("@")[0], relays: mail.whoami().relays })
          const pubkey = store.read<{ identity: string }>("config.json", null as never).identity
          write("Mining an 18-bit proof of work in a worker. Your identity key stays locked until signing.", "status")
          const work = await mine({ ...handleTemplate(payload, `${window.location.origin}/api/handles`), pubkey })
          const event = await store.withIdentity(passphrase, () => { const sk = hexToBytes(store.read<{ sk: string }>("identity.key", null as never).sk); try { return finalizeEvent(work, sk) } finally { sk.fill(0) } })
          const response = await fetch("/api/handles", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, event }) })
          const result = await response.json()
          if (response.status === 503) throw new Error("Handles are not enabled yet")
          if (!response.ok) throw new Error(result.error || "Handle claim refused")
          write(result); break
        }
        case "backup": {
          const blob = new Blob([store.backup()], { type: "application/json" }); const url = URL.createObjectURL(blob)
          const link = document.createElement("a"); link.href = url; link.download = `termnl-${store.name}-backup.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
          write("Downloaded a profile backup with encrypted keys. Keep it and your passphrase separately.", "status"); break
        }
        case "lock": lock(); write("Locked. Session keys discarded and relay connections closed.", "status"); break
        case "reset": setResetting(true); write("Confirm deletion below. Back up first: there is no recovery.", "status"); break
        default: throw new Error(`Unknown command ${cmd}. Type help.`)
      }
    } catch (error) {
      // Keys and passphrases are never included in console input or output.
      const message = error instanceof Error ? error.message : "Command failed"
      const shown = message.length > 1200 ? "Command failed validation; check help and the supplied values." : message
      write(shown, "error"); if (!session.current) setNotice(shown)
    } finally {
      if (!auto) setInput("")
      processing.current = false; setBusy(false)
    }
  }
  runRef.current = execute
  const submit = (event: FormEvent) => { event.preventDefault(); void execute(input) }

  const creating = adding || !profiles.length
  const needsPassphrase = /^\s*(rotate|handle\s+claim)\b/.test(input)
  const passphraseField = (label: string, create = false) => <label className="block text-xs text-t-body">{label}
    <TerminalInput aria-label="Profile passphrase" type="password" autoComplete={create ? "new-password" : "current-password"} required minLength={create ? 10 : undefined} value={password} onChange={event => setPassword(event.target.value)} disabled={busy} placeholder={create ? "At least 10 characters" : ""} className="mt-1" /></label>

  return <main className="min-h-screen p-2 sm:p-5">
    <div className="frame mx-auto max-w-4xl">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-t-line px-4 py-3 text-xs sm:px-6"><Link href="/" className="font-mono text-sm font-bold tracking-widest text-t-ink">TERMNL</Link><span className="flex items-center gap-4"><span className={active ? "text-t-accent" : "text-t-muted"}>{!ready ? "Opening..." : active ? `Unlocked · ${active}` : "Locked"}</span><ThemeToggle /></span></header>
      <div className="space-y-4 p-3 sm:p-6">
        {hasInvite && <div className="space-y-3 rounded-lg border border-t-accent p-4 text-sm text-t-ink">
          <p>{">"} Someone sent you a pairing invite.</p>
          {active
            ? <div className="flex flex-wrap gap-2"><button disabled={busy} className={button} onClick={() => void execute(`pair ${pendingInvite.current}`)}>Accept and pair</button><button className="px-2 text-xs text-t-muted underline" onClick={() => { pendingInvite.current = ""; setHasInvite(false) }}>ignore</button></div>
            : <p className="text-t-body">{creating ? "Create a profile" : "Unlock your profile"} below, then you can accept it.</p>}
        </div>}

        {ready && !active && <form className="mx-auto max-w-md space-y-4 rounded-lg border border-t-line-strong p-4 sm:p-6" onSubmit={event => { event.preventDefault(); void execute(creating ? `init ${newName}` : `unlock ${lockedName}`) }}>
          <h1 className="text-xl font-semibold text-t-ink">{creating ? "Create your profile" : "Welcome back"}</h1>
          <p className="text-sm leading-relaxed text-t-body">{creating ? "Two fields and you're set. No email, no account. Your keys are made and kept in this browser." : "Enter your passphrase to unlock your profile."}</p>
          {creating
            ? <label className="block text-xs text-t-body">PROFILE NAME<TerminalInput aria-label="Profile name" required pattern="[a-zA-Z0-9_\-]{1,32}" title="1 to 32 letters, numbers, _ or -" value={newName} onChange={event => setNewName(event.target.value)} disabled={busy} placeholder="e.g. sam" autoComplete="off" spellCheck={false} className="mt-1" /></label>
            : profiles.length > 1
              ? <label className="block text-xs text-t-body">PROFILE<select aria-label="Saved profile" className={field} value={lockedName} onChange={event => setLockedName(event.target.value)} disabled={busy}>{profiles.map(profile => <option key={profile} value={profile}>{profile}</option>)}</select></label>
              : <p className="text-sm text-t-ink">Profile: {lockedName}</p>}
          {passphraseField("PASSPHRASE", creating)}
          {creating && <p className="text-xs leading-relaxed text-t-warn">Write the passphrase down. It unlocks your keys and it cannot be reset.</p>}
          {notice && <p role="alert" className="text-sm text-t-danger">{notice}</p>}
          <button disabled={busy} className={`${button} w-full`}>{busy ? "Working..." : creating ? "Create profile" : "Unlock"}</button>
          <div className="flex flex-wrap justify-between gap-2 text-xs text-t-muted">
            {profiles.length > 0 && <button type="button" className="underline" onClick={() => { setAdding(!adding); setNotice("") }}>{creating ? "Use an existing profile" : "Create another profile"}</button>}
            <details className="w-full"><summary className="cursor-pointer underline">Restore from a backup file</summary><div className="mt-3 space-y-3"><TerminalInput aria-label="Restored profile name" placeholder="Name for the restored profile" value={restoreName} onChange={event => setRestoreName(event.target.value)} /><label className="block">Choose your Termnl backup file<input aria-label="Profile backup file" className="mt-2 block w-full" type="file" accept="application/json,.json" onChange={async event => { const file = event.target.files?.[0]; if (!file) return; try { if (file.size > 5*1024*1024) throw new Error("Backup is too large"); BrowserStore.restore(restoreName, await file.text()); setProfiles(BrowserStore.names()); setLockedName(restoreName); setAdding(false); setNotice(""); write("Backup restored. Enter its original passphrase to unlock.", "status") } catch (error) { const message = error instanceof Error ? error.message : "Restore failed"; write(message, "error"); setNotice(message) } event.target.value = "" }} /></label></div></details>
          </div>
        </form>}

        {active && <div className="flex flex-wrap gap-2 text-xs">{ACTIONS.map(([label, command]) => <button key={command} disabled={busy} onClick={() => run(command)} className="btn-sm">{label}</button>)}</div>}

        {active && pairLink && <div className="space-y-5 rounded-lg border border-t-line-strong p-4 sm:p-6">
          <h2 className="text-lg font-semibold text-t-ink">Pair with someone</h2>
          <div className="space-y-2">
            <p className="text-sm text-t-body">Send them this link privately. When they open it, you are paired.</p>
            <div className="flex flex-wrap gap-2">
              <input aria-label="Your pairing link" readOnly value={pairLink} onFocus={event => event.target.select()} className={`${field} mt-0 min-w-0 flex-1 font-mono text-xs`} />
              <button type="button" className="btn-sm" onClick={event => { const target = event.currentTarget; void navigator.clipboard.writeText(pairLink).then(() => { target.textContent = "Copied" }) }}>Copy link</button>
              {"share" in navigator && <button type="button" className="btn-sm" onClick={() => void navigator.share({ title: "Pair with me on Termnl", url: pairLink }).catch(() => undefined)}>Share</button>}
            </div>
            <p className="flex items-center gap-2 text-xs text-t-muted"><span className="h-2 w-2 animate-pulse rounded-full bg-t-accent" />Waiting for them to open it. Works once, for 60 minutes. Whoever opens it first is paired with you.</p>
          </div>
          <form className="space-y-2 border-t border-t-line pt-4" onSubmit={event => { event.preventDefault(); void execute(`pair ${theirLink.trim()}`) }}>
            <p className="text-sm text-t-body">Or, if they sent you a link, paste it here.</p>
            <div className="flex flex-wrap gap-2"><input aria-label="Their pairing link" required value={theirLink} onChange={event => setTheirLink(event.target.value)} placeholder="https://termnl.app/pair#..." autoComplete="off" spellCheck={false} className={`${field} mt-0 min-w-0 flex-1 font-mono text-xs`} /><button disabled={busy} className="btn-sm">Pair</button></div>
          </form>
          <button type="button" className="text-xs text-t-muted underline" onClick={() => setPairLink("")}>Close</button>
        </div>}

        {active && draft && <form className="space-y-4 rounded-lg border border-t-line-strong p-4 sm:p-6" onSubmit={event => { event.preventDefault(); void execute(`send ${draft.to} ${draft.kind} ${quote(draft.subject)}${draft.details ? ` --details ${quote(draft.details)}` : ""}${draft.amount ? ` --amount ${draft.amount}` : ""}${draft.due ? ` --due ${draft.due}` : ""}`) }}>
          <h2 className="text-lg font-semibold text-t-ink">Send a request</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-xs text-t-body">TO<select aria-label="Send to" className={field} value={draft.to} onChange={event => setDraft({ ...draft, to: event.target.value })}>{session.current?.mail.contacts().map(contact => <option key={contact.identity} value={npubEncode(contact.identity)}>{contact.name ?? npubEncode(contact.identity).slice(0, 16)}</option>)}</select></label>
            <label className="block text-xs text-t-body">WHAT IS IT?<select aria-label="Kind of request" className={field} value={draft.kind} onChange={event => setDraft({ ...draft, kind: event.target.value })}>{Object.entries(KINDS).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select></label>
          </div>
          <label className="block text-xs text-t-body">SUBJECT<TerminalInput aria-label="Subject" required maxLength={200} value={draft.subject} onChange={event => setDraft({ ...draft, subject: event.target.value })} placeholder="e.g. Can you review the draft by Friday?" className="mt-1" /></label>
          <label className="block text-xs text-t-body">DETAILS (optional)<textarea aria-label="Details" maxLength={4000} rows={3} className={field} value={draft.details} onChange={event => setDraft({ ...draft, details: event.target.value })} /></label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-xs text-t-body">AMOUNT IN AUD (optional)<TerminalInput aria-label="Amount" type="number" min="0" step="any" value={draft.amount} onChange={event => setDraft({ ...draft, amount: event.target.value })} className="mt-1" /></label>
            <label className="block text-xs text-t-body">DUE DATE (optional)<TerminalInput aria-label="Due date" type="date" value={draft.due} onChange={event => setDraft({ ...draft, due: event.target.value })} className="mt-1" /></label>
          </div>
          <p className="text-xs leading-relaxed text-t-muted">Encrypted before it leaves this browser. Nothing is agreed until they accept and both sides sign.</p>
          <div className="flex flex-wrap items-center gap-4"><button disabled={busy} className={button}>{busy ? "Sending..." : "Send"}</button><button type="button" className="text-xs text-t-muted underline" onClick={() => setDraft(null)}>Cancel</button></div>
        </form>}
        <div className={`${active ? "h-[48vh] min-h-64" : "max-h-40"} overflow-y-auto rounded-lg border border-green-900 bg-gray-950 p-3 font-mono terminal-scroll`} role="log" aria-label="Terminal output" aria-live="polite">
          {entries.map(entry => <div key={entry.id} className={`mb-4 whitespace-pre-wrap break-words text-xs leading-relaxed sm:text-sm ${entry.kind === "error" ? "text-red-400" : entry.kind === "peer" ? "text-amber-400" : entry.kind === "status" ? "text-green-600" : "text-green-300"}`}>
            {entry.kind === "peer" && <p className="mb-1 text-[10px] tracking-widest">[INCLUDES TEXT FROM THE OTHER PARTY · UNTRUSTED]</p>}{entry.text}
            {entry.copy && <button className="mt-2 block border border-green-500 px-3 py-1 text-xs hover:bg-green-400 hover:text-black" onClick={event => { const target = event.currentTarget; void navigator.clipboard.writeText(entry.copy!).then(() => { target.textContent = "[COPIED]" }) }}>[COPY LINK]</button>}
            {!!entry.actions?.length && <div className="mt-2 flex flex-wrap gap-2">{entry.actions.map(([label, command]) => <button key={label} disabled={busy} className="border border-green-500 px-3 py-1 text-xs uppercase text-green-300 hover:bg-green-400 hover:text-black disabled:opacity-40" onClick={() => run(command)}>[{label}]</button>)}</div>}
          </div>)}<div ref={outputEnd} />
        </div>
        <form onSubmit={submit} className="space-y-3">
          {active && needsPassphrase && passphraseField("PASSPHRASE / needed again for this command")}
          <div className="flex gap-2"><span className="self-center text-t-muted">{">"}</span><TerminalInput ref={commandInput} aria-label="Terminal command" value={input} onChange={event => setInput(event.target.value)} placeholder={active ? "type a command, or help" : "help"} disabled={!ready || busy} autoComplete="off" spellCheck={false} /><button disabled={!ready || busy || !input.trim()} className="btn-sm">{busy ? "Working" : "Run"}</button></div>
        </form>
        {resetting && <div role="alertdialog" aria-label="Delete local profile" className="space-y-3 border border-t-danger p-4 text-sm text-t-danger"><p>Delete {active} and its keys/history from this browser? This cannot be undone without a backup.</p><button className="mr-4 border border-t-danger p-2" onClick={() => { session.current?.store.reset(); lock(); setProfiles(BrowserStore.names()); setLockedName(BrowserStore.names()[0] || ""); setResetting(false); setEntries([{ id: ++counter.current, text: "Local profile deleted.", kind: "status" }]) }}>[DELETE THIS PROFILE]</button><button className="border border-t-line-strong p-2 text-t-accent" onClick={() => setResetting(false)}>[CANCEL]</button></div>}
        <p className="text-xs leading-relaxed text-t-muted">Prototype: no security review, forward secrecy or remote signing. Public relays can lose messages. A compromised page can read unlocked keys. Peer text is untrusted. Back up before clearing browser data. New messages are fetched every 30 seconds while unlocked.</p>
      </div>
    </div>
  </main>
}
