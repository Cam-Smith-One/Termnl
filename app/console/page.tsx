"use client"

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react"
import Link from "next/link"
import { finalizeEvent } from "nostr-tools/pure"
import type { UnsignedEvent } from "nostr-tools/pure"
import { hexToBytes } from "nostr-tools/utils"
import { npubEncode } from "nostr-tools/nip19"
import { TerminalInput } from "@/components/terminal-input"
import { Termnl, type InboxItem } from "@/lib/termnl/core"
import { BrowserStore, profileName } from "@/lib/termnl/browser-store"
import { DEFAULT_RELAYS, type RequestBody } from "@/lib/termnl/protocol"
import { handlePayload, handleTemplate, handleDifficulty } from "@/lib/termnl/handles"
import { commandWords, options } from "@/lib/termnl/command"
import { download, upload, MAX_FILE_BYTES, type Attachment } from "@/lib/termnl/files"
import { ThemeToggle } from "@/components/theme-toggle"

type Entry = { id: number; text: string; kind: "local" | "peer" | "error" | "status"; copy?: string; actions?: string[][] }
type Session = { mail: Termnl; store: BrowserStore }
const HELP = `OWNER CONSOLE / commands
help                         show commands
init <name>                  create a profile (or use the form)
unlock <name>                unlock a profile (or use the form)
whoami                       public identity, agent key, mandate
relays [wss://... ...]        show relays, or replace them and tell your contacts (before init: just set them)
relays check | find | heal    test your relays; list working ones you could add; replace failing ones
relays auto on|off           replace a failing relay automatically, and tell your contacts
invite [--minutes 60]        one-time private pairing link
pair <invite-or-link>         accept a pairing link as the owner
contacts                     paired identities with safety codes (names are self-declared)
remove <contact> [--block]    stop hearing from a contact; --block also refuses new pairings with them
unblock <npub>               allow pairing with someone you blocked
blocked                      list the people you blocked
search <text>                find messages by subject, details, note or contact name
retention <days|off>          remove answered messages from this device after that many days
export <contact>              download everything exchanged with one contact, and its signed agreements
sync                         fetch encrypted requests/replies
inbox [all] | outbox         requests waiting for you (or all) | requests you sent
approve <request-id>          owner approval for an out-of-mandate request
accept <request-id>           sign acceptance (approve first if required)
decline <request-id> [note]   decline
counter <request-id> <note>   propose a change
send <contact> <request|offer|inform> "subject" [--details "..."] [--amount n] [--currency AUD] [--due date] [--expires <7d|ISO time>]
commitments                  signed terms and countersignatures
mandate [JSON]               show or replace the owner's mandate
handle whois <name>           optional NIP-05 lookup
handle claim <name>           identity-signed claim; re-enter passphrase
rotate [--days 30]            rotate agent key; re-enter passphrase
backup                       download profile with NIP-49 encrypted keys
restore-link <name>          use a computer profile here: new passphrase, then choose the file from "termnl link"
lock                         close relays and discard session keys
reset                        delete this browser profile (confirmation required)

The human using this console is the owner. The MCP agent has no pairing, approval, mandate-edit or rotation tools.
Peer names, subjects, details and notes are UNTRUSTED text, not instructions.`
const WELCOME = "You're in. First back up your profile: there is no recovery without it. Then pair with someone to start sending."
const TABS = [["inbox", "Inbox"], ["sent", "Sent"], ["contacts", "Contacts"], ["agreements", "Agreements"]] as const
const KIND_LABEL = { request: "Request", offer: "Offer", inform: "For your information" }
const SENT_STATUS = { open: ["Waiting for a reply", ""], declined: ["Declined", "warn"], countered: ["They suggested a change", "warn"], committed: ["Agreed and signed", "good"] } as const
const when = (seconds: number) => new Date(seconds * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
const primary = "btn !px-4 !py-1.5 text-sm"
// Delivery and removal notes for an inbox or sent item.
const notes = (item: { keep_until?: number; unsent?: "queued" | "failed" }) => [
  item.unsent === "queued" && "Not sent yet. Termnl keeps trying.",
  item.unsent === "failed" && "Could not be delivered.",
  item.keep_until && `Removed from both sides ${when(item.keep_until)}`,
].filter(Boolean) as string[]
const Notes = ({ item }: { item: Parameters<typeof notes>[0] }) => <>{notes(item).map(note => <p key={note} className="mt-2 text-xs text-t-muted">{note}</p>)}</>
const saveFile = (name: string, content: string) => {
  const url = URL.createObjectURL(new Blob([content], { type: "application/json" }))
  const link = document.createElement("a"); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// Everything a card shows about the other party (name, subject, details, notes) is their text: rendered as plain text only.
const Avatar = ({ name, small }: { name?: string; small?: boolean }) => <span aria-hidden className={`flex shrink-0 items-center justify-center rounded-full bg-t-tint font-semibold text-t-accent ${small ? "h-6 w-6 text-xs" : "h-10 w-10 text-sm"}`}>{(name?.trim()[0] ?? "?").toUpperCase()}</span>
const Chip = ({ children, tone = "" }: { children: ReactNode; tone?: string }) => <span className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] ${tone === "warn" ? "border-t-warn-line bg-t-warn-bg text-t-warn" : tone === "good" ? "border-t-accent bg-t-tint text-t-accent" : "border-t-line-strong text-t-muted"}`}>{children}</span>
const Card = ({ name, meta, chips, children }: { name?: string; meta: string; chips?: ReactNode; children?: ReactNode }) => <article className="flex gap-3 rounded-lg border border-t-line bg-t-panel p-4">
  <Avatar name={name} />
  <div className="min-w-0 flex-1">
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className="break-all font-medium text-t-ink">{name ?? "(no name)"}</span><span className="text-xs text-t-muted">{meta}</span><span className="ml-auto flex flex-wrap gap-1">{chips}</span></div>
    {children}
  </div>
</article>
const Terms = ({ body }: { body: RequestBody }) => <>
  <p className="mt-1 break-words text-base font-semibold text-t-ink">{body.subject}</p>
  {body.details && <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-t-body">{body.details}</p>}
  {(body.value || body.due) && <div className="mt-2 flex flex-wrap gap-2">{body.value && <Chip>{body.value.amount} {body.value.currency}</Chip>}{body.due && <Chip>Due {body.due}</Chip>}</div>}
  {!!body.attachments?.length && <div className="mt-2 flex flex-wrap gap-2">{body.attachments.map(file => <FileChip key={file.sha256} file={file} />)}</div>}
</>
const size = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
// Decrypts in the browser and hands the file to the browser's own download, as a generic file so nothing is rendered or run here.
function FileChip({ file }: { file: Attachment }) {
  const [state, setState] = useState("Download")
  const fetchIt = async () => {
    setState("Decrypting...")
    try {
      const url = URL.createObjectURL(new Blob([await download(file) as BlobPart], { type: "application/octet-stream" }))
      const link = document.createElement("a"); link.href = url; link.download = file.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
      setState("Saved")
    } catch { setState("Unavailable") }
  }
  return <span className="flex max-w-full items-center gap-2 rounded-md border border-t-line-strong px-2 py-1 text-xs text-t-body"><span className="truncate font-medium text-t-ink">{file.name}</span><span className="whitespace-nowrap text-t-muted">{size(file.size)}</span><button type="button" disabled={state !== "Download"} className="whitespace-nowrap text-t-accent underline disabled:no-underline disabled:opacity-60" onClick={() => void fetchIt()}>{state}</button></span>
}
const Empty = ({ children }: { children: ReactNode }) => <div className="rounded-lg border border-dashed border-t-line-strong p-8 text-center text-sm text-t-muted">{children}</div>
const button = "btn"
const field = "mt-1 w-full rounded-md border border-t-line-strong bg-t-field p-2 text-base text-t-ink focus:border-t-accent focus:outline-none focus:ring-1 focus:ring-t-accent"
const KINDS = { request: "Ask them for something", offer: "Offer them something", inform: "Just let them know" }
const EMPTY = { to: "", kind: "request", subject: "", details: "", amount: "", due: "" }
// ponytail: the form builds a send command so there is one send path; a subject starting with "--" is read as a flag.
const quote = (value: string) => `"${value.replace(/[\\"]/g, "\\$&")}"`
const text = (value: unknown) => typeof value === "string" ? value : JSON.stringify(value, null, 2)

function mine(event: UnsignedEvent, difficulty: number): Promise<Omit<UnsignedEvent, never>> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./pow.worker.ts", import.meta.url))
    const timer = setTimeout(() => { worker.terminate(); reject(new Error("Proof of work timed out; try again")) }, 300000)
    worker.onmessage = message => { clearTimeout(timer); worker.terminate(); message.data.error ? reject(new Error(message.data.error)) : resolve(message.data.event) }
    worker.onerror = () => { clearTimeout(timer); worker.terminate(); reject(new Error("Proof-of-work worker failed")) }
    worker.postMessage({ event, difficulty })
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
  const [linkName, setLinkName] = useState("")
  const [pairLink, setPairLink] = useState("")
  const [theirLink, setTheirLink] = useState("")
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("inbox")
  const [, setRev] = useState(0) // bumped after every command so the cards re-read the profile
  const [find, setFind] = useState("")
  const [showAnswered, setShowAnswered] = useState(false)
  const [counterFor, setCounterFor] = useState("")
  const [counterNote, setCounterNote] = useState("")
  const [logOpen, setLogOpen] = useState(false)
  const [dismissed, setDismissed] = useState(0)
  const [entries, setEntries] = useState<Entry[]>([{ id: 0, text: "Welcome to Termnl. Everything you do shows up here.", kind: "status" }])
  const session = useRef<Session | null>(null)
  const relays = useRef([...DEFAULT_RELAYS])
  const pendingInvite = useRef("")
  const linkPass = useRef("")
  const draftFiles = useRef<File[]>([])
  const processing = useRef(false)
  const counter = useRef(0)
  const outputEnd = useRef<HTMLDivElement>(null)
  const commandInput = useRef<HTMLInputElement>(null)
  const runRef = useRef<(line: string, auto?: boolean) => Promise<void>>()
  const write = (value: unknown, kind: Entry["kind"] = "local", extra: Pick<Entry, "copy" | "actions"> = {}) => setEntries(previous => [...previous, { id: ++counter.current, text: text(value), kind, ...extra }].slice(-200))
  const lock = () => { session.current?.mail.close(); session.current?.store.lock(); session.current = null; setActive(""); setPassword(""); setDraft(null); setPairLink("") }
  const compose = (to = "") => {
    const first = session.current?.mail.contacts()[0]
    if (!first) return write("Pair with someone first: use Pair with someone and send them the link.", "status")
    draftFiles.current = []; setPairLink(""); setDraft({ ...EMPTY, to: to || npubEncode(first.identity) })
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
  useEffect(() => { if (logOpen) outputEnd.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }) }, [entries, logOpen])

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
        setTimeout(() => void runRef.current?.("sync", true), 0)
        return
      }
      if (cmd === "relays" && !session.current) {
        const urls = commandWords(line).slice(1)
        if (urls.length) { const { relayList } = await import("@/lib/termnl/protocol"); relays.current = relayList.parse(urls) }
        write(relays.current); return
      }
      if (cmd === "restore-link") {
        const name = profileName(commandWords(line)[1] || "")
        if (BrowserStore.names().includes(name)) throw new Error(`A profile called "${name}" already exists here. Choose a new name.`)
        if (passphrase.length < 10) throw new Error("Enter a new passphrase of at least 10 characters in the passphrase field, then run the command again.")
        linkPass.current = passphrase; setLinkName(name)
        write("Now choose the file made by termnl link. Your keys are encrypted with this passphrase before they are saved here.", "status"); return
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
      const { args, flags } = options(commandWords(line).slice(1), ["block"])
      // Names, subjects, details and notes come from the other party: always written with kind "peer".
      const who = (identity: string) => `"${mail.contacts().find(contact => contact.identity === identity)?.name ?? (identity.startsWith("email:") ? `${identity.slice(6)} (by email, sender not verified)` : "(no name)")}"`
      const terms = (body: RequestBody) => [`Subject: ${body.subject}`, body.details && `Details: ${body.details}`, body.value && `Value: ${body.value.amount} ${body.value.currency}`, body.due && `Due: ${body.due}`].filter(Boolean).join("\n")
      const sync = async () => {
        const confirmed = () => mail.contacts().filter(contact => !contact.pending)
        const known = new Set(confirmed().map(contact => contact.identity))
        const result = await mail.sync()
        for (const contact of confirmed().filter(contact => !known.has(contact.identity))) {
          setPairLink("")
          write(`You are now paired with ${who(contact.identity)}. That name is what they chose; it is not verified.`, "peer", { actions: [["send a request", `compose ${npubEncode(contact.identity)}`]] })
        }
        return result
      }
      const showInbox = (item: InboxItem) => write(
        `${item.body.kind.toUpperCase()} from ${who(item.from)} · ${when(item.received_at)} · ${item.status}\n${terms(item.body)}${item.status === "open" && item.authority === "needs_owner" ? "\nThis is outside your agent's limits. Approve it before it can be accepted." : ""}${notes(item).map(note => `\n${note}`).join("")}`,
        "peer", { actions: item.status !== "open" ? [] : [item.authority === "needs_owner" ? ["approve", `approve ${item.id}`] : ["accept", `accept ${item.id}`], ["decline", `decline ${item.id}`], ["counter", `counter ${item.id} `]] })
      switch (cmd) {
        case "whoami": write(mail.whoami()); break
        case "relays": {
          const show = (list: { url: string; ok: boolean; ms?: number; error?: string }[]) => list.map(probe => `${probe.ok ? "ok  " : "FAIL"} ${probe.url}${probe.ok ? ` (${probe.ms} ms)` : ` - ${probe.error}`}`).join("\n") || "None found"
          if (!args.length) write(mail.whoami().relays)
          else if (args[0] === "check") write(show(await mail.checkRelays()))
          else if (args[0] === "find") write(show(await mail.findRelays()))
          else if (args[0] === "heal") write(await mail.healRelays())
          else if (args[0] === "auto") {
            if (args[1] === "on" || args[1] === "off") mail.setPrefs({ autoRelays: args[1] === "on" })
            write(`Automatic relay replacement is ${mail.prefs().autoRelays ? "on: a relay that stops working is replaced, at most once a day, and your contacts are told" : "off"}`, "status")
          } else write(await mail.changeRelays(args))
          break
        }
        case "invite": {
          const minutes = Number(flags.minutes ?? 60), link = `https://termnl.app/pair#${mail.createInvite(minutes)}`
          write(`Send this link to the person you want to pair with. It works once and expires in ${minutes} minutes.\nKeep it private: anyone who opens it first is paired with you.\n\n${link}`, "local", { copy: link }); setPairLink(link); setDraft(null); break
        }
        case "pair": {
          const contact = await mail.acceptInvite(args[0] || "")
          pendingInvite.current = ""; setHasInvite(false); setPairLink(""); setTheirLink("")
          write(contact.pending ? `Pairing started with "${contact.name ?? "(no name)"}". That name is what they chose; it is not verified.\nTheir ID: ${npubEncode(contact.identity)}\nIt is confirmed once their console sees it, usually within seconds if they have it open. You can send after that.` : `Paired with "${contact.name ?? "(no name)"}".`, "peer"); break
        }
        case "contacts": {
          if (!mail.contacts().length) { write("No contacts yet. Use Pair with someone to get a pairing link.", "status"); break }
          for (const contact of mail.contacts()) write(`${who(contact.identity)} · ${contact.pending ? "waiting for them to confirm" : `paired ${when(contact.paired_at)}`}\nThe name is what they chose; it is not verified.\nID: ${npubEncode(contact.identity)}\nSafety code: ${mail.safetyCode(contact.identity)} (read it to them over a call; it should match)`, "peer", { actions: [["send a request", `compose ${npubEncode(contact.identity)}`]] })
          break
        }
        case "sync": { const result = await sync(); if (!auto || result.processed || result.dropped) write(`Checked for new messages: ${result.processed} new${result.dropped ? `, ${result.dropped} ignored` : ""}.${result.capped ? "\nYour relay returned the most this check will fetch. If someone is flooding your address, real messages may be delayed; rotating your agent key gives you a fresh address." : ""}`, "status"); break }
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
          if (!mail.outbox().length) { write("You haven't sent anything yet. Open Contacts to send one.", "status"); break }
          const status = { open: "waiting for a reply", declined: "declined", countered: "they proposed a change", committed: "agreed and signed by both sides" }
          for (const item of mail.outbox()) write(`${item.body.kind.toUpperCase()} to ${who(item.to)} · ${when(item.sent_at)} · ${status[item.status]}\n${terms(item.body)}${item.note ? `\nTheir note: ${item.note}` : ""}${notes(item).map(note => `\n${note}`).join("")}`, "peer")
          break
        }
        case "approve": { const item = mail.approve(args[0] || ""); write("Approved. Nothing is signed until you accept it.", "status"); showInbox(item); break }
        case "accept": case "decline": case "counter": {
          const item = await mail.respond(args[0] || "", cmd, args.slice(1).join(" ") || undefined)
          write(`${cmd === "accept" ? "Accepted" : cmd === "decline" ? "Declined" : "Countered"} the ${item.body.kind} from ${who(item.from)}.${cmd === "accept" && !item.email ? " You signed the terms; see Agreements for their countersignature." : ""}`, "peer"); break
        }
        case "send": {
          const [to, kind, subject] = args
          if (!to || !kind || !subject) throw new Error('send <contact> <request|offer|inform> "subject" [--amount n] [--currency AUD]')
          const value = flags.amount !== undefined ? { amount: Number(flags.amount), currency: flags.currency || "AUD" } : undefined
          const files = draftFiles.current
          if (files.length > 4 || files.some(file => !file.size || file.size > MAX_FILE_BYTES)) throw new Error(`Attach up to 4 files of at most ${MAX_FILE_BYTES / 1024 / 1024} MB each`)
          const attachments = files.length ? await Promise.all(files.map(async file => upload({ name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) }))) : undefined
          const days = /^(\d+)d$/.exec(flags.expires ?? "")?.[1]
          const keepUntil = flags.expires ? Math.floor(days ? Date.now() / 1000 + Number(days) * 86400 : Date.parse(flags.expires) / 1000) : undefined
          if (flags.expires && !Number.isFinite(keepUntil)) throw new Error("--expires takes a number of days (7d) or an ISO time")
          const item = await mail.sendRequest(to, { kind: kind as "request" | "offer" | "inform", subject, details: flags.details, value, due: flags.due, attachments }, { owner: true, keepUntil })
          draftFiles.current = []; setDraft(null); write(item.unsent === "queued" ? `Not sent yet: no relay could be reached. Termnl keeps trying for three days. It will show under Sent.` : `Sent to ${who(item.to)}. Their reply will show under Sent.`, "peer"); break
        }
        case "search": {
          if (!args.length) throw new Error("search <text>")
          const found = mail.search(args.join(" "))
          if (!found.length) { write("Nothing matches that.", "status"); break }
          for (const { dir, at, item } of found) write(`${item.body.kind.toUpperCase()} ${"from" in item ? `from ${who(item.from)}` : `to ${who(item.to)}`} · ${when(at)}\n${terms(item.body)}${"note" in item && item.note ? `\nTheir note: ${item.note}` : ""}${notes(item).map(note => `\n${note}`).join("")}`, "peer")
          break
        }
        case "remove": {
          if (!args[0]) throw new Error("remove <contact> [--block]")
          const contact = mail.removeContact(args[0], { block: !!flags.block })
          write(`${flags.block ? "Blocked" : "Removed"} "${contact.name ?? npubEncode(contact.identity)}". Their messages are now ignored; they have not been told. Your history with them is kept.`, "peer"); break
        }
        case "unblock": { if (!args[0]) throw new Error("unblock <npub>"); mail.unblock(args[0]); write("Unblocked. Pair again to hear from them.", "status"); break }
        case "blocked": { const list = mail.blocked(); write(list.length ? list.map(id => npubEncode(id)).join("\n") : "No one is blocked.", "status"); break }
        case "retention": {
          if (args[0]) {
            const days = args[0] === "off" ? undefined : Number(args[0])
            if (days !== undefined && !(days >= 1 && days <= 3650)) throw new Error("retention <days|off>")
            mail.setPrefs({ keepDays: days })
          }
          const keep = mail.prefs().keepDays
          write(keep ? `Answered messages are removed from this device after ${keep} days. Signed agreements are kept.` : "Messages are kept until you remove the profile.", "status"); break
        }
        case "export": {
          if (!args[0]) throw new Error("export <contact>")
          const contact = mail.resolveContact(args[0])
          const record = { exported_at: new Date().toISOString(), owner: mail.whoami().identity, contact: { name: contact.name, npub: npubEncode(contact.identity) }, messages: mail.conversation(args[0]), agreements: mail.commitments().filter(item => item.with === contact.identity) }
          saveFile(`termnl-export-${npubEncode(contact.identity).slice(0, 16)}.json`, JSON.stringify(record, null, 2))
          write(`Downloaded ${record.messages.length} messages and ${record.agreements.length} signed agreements with "${contact.name ?? "this contact"}".`, "peer"); break
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
          write(`Working out a proof of work for this name${payload.name.length <= 5 ? " (short names take longer, up to a few minutes)" : ""}. Your identity key stays locked until signing.`, "status")
          const work = await mine({ ...handleTemplate(payload, `${window.location.origin}/api/handles`), pubkey }, handleDifficulty(payload.name))
          const event = await store.withIdentity(passphrase, () => { const sk = hexToBytes(store.read<{ sk: string }>("identity.key", null as never).sk); try { return finalizeEvent(work, sk) } finally { sk.fill(0) } })
          const response = await fetch("/api/handles", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, event }) })
          const result = await response.json()
          if (response.status === 503) throw new Error("Handles are not enabled yet")
          if (!response.ok) throw new Error(result.error || "Handle claim refused")
          write(result); break
        }
        case "backup": {
          saveFile(`termnl-${store.name}-backup.json`, store.backup())
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
      processing.current = false; setBusy(false); setRev(rev => rev + 1)
    }
  }
  runRef.current = execute
  const submit = (event: FormEvent) => { event.preventDefault(); void execute(input) }

  const creating = adding || !profiles.length
  const mail = active ? session.current?.mail : undefined
  const contacts = mail?.contacts() ?? []
  const nameOf = (identity: string) => contacts.find(contact => contact.identity === identity)?.name ?? (identity.startsWith("email:") ? `${identity.slice(6)} (by email, sender not verified)` : undefined)
  const matches = (contact: (typeof contacts)[number]) => !find.trim() || `${contact.name ?? ""} ${npubEncode(contact.identity)}`.toLowerCase().includes(find.trim().toLowerCase())
  const inboxItems = mail?.inbox().slice().reverse() ?? []
  const openItems = inboxItems.filter(item => item.status === "open"), answered = inboxItems.filter(item => item.status !== "open")
  const termsOf = (content: string): RequestBody => { try { return JSON.parse(content).terms } catch { return { kind: "inform", subject: "(unreadable terms)" } } }
  const last = entries[entries.length - 1]
  const needsPassphrase = /^\s*(rotate|restore-link|handle\s+claim)\b/.test(input)
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

        {linkName && <div className="mx-auto max-w-md space-y-3 rounded-lg border border-t-accent p-4 text-sm text-t-ink">
          <label className="block">Choose the file made by termnl link, for the profile &ldquo;{linkName}&rdquo;<input aria-label="Computer profile link file" className="mt-2 block w-full" type="file" accept="application/json,.json" onChange={async event => {
            const file = event.target.files?.[0]; event.target.value = ""; if (!file) return
            try {
              if (file.size > 5 * 1024 * 1024) throw new Error("Link file is too large")
              BrowserStore.importLinked(linkName, await file.text(), linkPass.current)
              setProfiles(BrowserStore.names()); setLockedName(linkName); setAdding(false); setNotice(""); linkPass.current = ""; setLinkName("")
              write(`Profile "${linkName}" is ready. Unlock it with the new passphrase. Delete the link file now: it holds your keys in plain text.`, "status")
            } catch (error) { write(error instanceof Error ? error.message : "Link failed", "error") }
          }} /></label>
          <button type="button" className="text-xs text-t-muted underline" onClick={() => { linkPass.current = ""; setLinkName("") }}>Cancel</button>
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

        {active && <div className="flex flex-wrap items-center gap-2">
          <button disabled={busy} className={primary} onClick={() => compose()}>New message</button>
          <button disabled={busy} className="btn-sm" onClick={() => run("invite")}>Pair with someone</button>
          <button disabled={busy} className="btn-sm" onClick={() => void execute("sync")}>{busy ? "Working..." : "Check for new"}</button>
          <span className="ml-auto flex gap-4 text-xs text-t-muted">{[["Back up", "backup"], ["Help", "help"], ["Lock", "lock"]].map(([label, command]) => <button key={command} disabled={busy} className="underline hover:text-t-ink" onClick={() => { if (command === "help") setLogOpen(true); run(command) }}>{label}</button>)}</span>
        </div>}
        {active && last && last.id > dismissed && !last.text.startsWith("> ") && <div role="status" className={`flex items-start gap-3 rounded-md border px-3 py-2 text-sm ${last.kind === "error" ? "border-t-danger text-t-danger" : "border-t-line bg-t-tint text-t-body"}`}><p className="line-clamp-3 min-w-0 flex-1 whitespace-pre-wrap break-words">{last.text}</p><button aria-label="Dismiss" className="text-t-muted hover:text-t-ink" onClick={() => setDismissed(last.id)}>×</button></div>}

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
          <h2 className="text-lg font-semibold text-t-ink">New message</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <fieldset className="min-w-0 sm:col-span-2"><legend className="text-xs text-t-body">TO</legend>
              {contacts.length > 8 && <input aria-label="Find a contact" value={find} onChange={event => setFind(event.target.value)} placeholder="Find a contact" className={field} />}
              <div className="mt-2 flex max-h-40 flex-wrap gap-2 overflow-y-auto">{contacts.filter(matches).map(contact => { const id = npubEncode(contact.identity), on = draft.to === id; return <button type="button" key={id} aria-pressed={on} onClick={() => setDraft({ ...draft, to: id })} className={`flex max-w-full items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-sm ${on ? "border-t-accent bg-t-tint font-medium text-t-ink" : "border-t-line-strong text-t-body hover:border-t-accent"}`}><Avatar small name={contact.name} /><span className="truncate">{contact.name ?? id.slice(0, 16)}</span></button> })}</div>
            </fieldset>
            <label className="block text-xs text-t-body sm:col-span-2">WHAT IS IT?<select aria-label="Kind of request" className={field} value={draft.kind} onChange={event => setDraft({ ...draft, kind: event.target.value })}>{Object.entries(KINDS).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select></label>
          </div>
          <label className="block text-xs text-t-body">SUBJECT<TerminalInput aria-label="Subject" required maxLength={200} value={draft.subject} onChange={event => setDraft({ ...draft, subject: event.target.value })} placeholder="e.g. Can you review the draft by Friday?" className="mt-1" /></label>
          <label className="block text-xs text-t-body">DETAILS (optional)<textarea aria-label="Details" maxLength={4000} rows={3} className={field} value={draft.details} onChange={event => setDraft({ ...draft, details: event.target.value })} /></label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-xs text-t-body">AMOUNT IN AUD (optional)<TerminalInput aria-label="Amount" type="number" min="0" step="any" value={draft.amount} onChange={event => setDraft({ ...draft, amount: event.target.value })} className="mt-1" /></label>
            <label className="block text-xs text-t-body">DUE DATE (optional)<TerminalInput aria-label="Due date" type="date" value={draft.due} onChange={event => setDraft({ ...draft, due: event.target.value })} className="mt-1" /></label>
          </div>
          <label className="block text-xs text-t-body">ATTACH FILES (optional, up to 4, 10 MB each)<input aria-label="Attach files" type="file" multiple className="mt-1 block w-full text-sm text-t-body" onChange={event => { draftFiles.current = [...(event.target.files ?? [])] }} /></label>
          <p className="text-xs leading-relaxed text-t-muted">Message and files are encrypted before they leave this browser. Nothing is agreed until they accept and both sides sign.</p>
          <div className="flex flex-wrap items-center gap-4"><button disabled={busy} className={button}>{busy ? "Sending..." : "Send"}</button><button type="button" className="text-xs text-t-muted underline" onClick={() => setDraft(null)}>Cancel</button></div>
        </form>}
        {active && mail && <section className="space-y-3">
          <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-t-line">{TABS.map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2 text-sm ${tab === id ? "border-t-accent font-semibold text-t-ink" : "border-transparent text-t-muted hover:text-t-ink"}`}>{label}{id === "inbox" && openItems.length > 0 && <span className="rounded-full bg-t-accent px-1.5 text-[11px] font-semibold text-t-accent-ink">{openItems.length}</span>}</button>)}</div>

          {tab === "inbox" && <>
            {!openItems.length && <Empty>Nothing is waiting for you. New messages arrive here automatically while this page is open.</Empty>}
            {[...openItems, ...(showAnswered ? answered : [])].map(item => <Card key={item.id} name={nameOf(item.from)} meta={when(item.received_at)} chips={<><Chip>{KIND_LABEL[item.body.kind]}</Chip>{item.status !== "open" && <Chip tone={item.status === "accepted" ? "good" : "warn"}>{item.status === "countered" ? "You suggested a change" : `You ${item.status}`}</Chip>}</>}>
              <Terms body={item.body} /><Notes item={item} />
              {item.status === "open" && <>
                {item.authority === "needs_owner" && <p className="mt-3 rounded-md border border-t-warn-line bg-t-warn-bg px-3 py-2 text-xs text-t-warn">This is outside the limits you set for your agent. Approve it first if you want to accept it.</p>}
                <div className="mt-3 flex flex-wrap gap-2">
                  {item.authority === "needs_owner"
                    ? <button disabled={busy} className={primary} onClick={() => void execute(`approve ${item.id}`)}>Approve</button>
                    : <button disabled={busy} className={primary} onClick={() => void execute(`accept ${item.id}`)}>{item.body.kind === "inform" ? "Acknowledge" : "Accept"}</button>}
                  <button disabled={busy} className="btn-sm" onClick={() => void execute(`decline ${item.id}`)}>Decline</button>
                  <button disabled={busy} className="btn-sm" onClick={() => { setCounterFor(counterFor === item.id ? "" : item.id); setCounterNote("") }}>Suggest a change</button>
                </div>
                {counterFor === item.id && <form className="mt-3 flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); void execute(`counter ${item.id} ${quote(counterNote)}`); setCounterFor("") }}>
                  <input aria-label="What would you change?" required maxLength={500} autoFocus value={counterNote} onChange={event => setCounterNote(event.target.value)} placeholder="What would you change?" className={`${field} mt-0 min-w-0 flex-1`} /><button disabled={busy} className="btn-sm">Send reply</button>
                </form>}
              </>}
            </Card>)}
            {answered.length > 0 && <button className="text-xs text-t-muted underline" onClick={() => setShowAnswered(!showAnswered)}>{showAnswered ? "Hide" : "Show"} {answered.length} answered</button>}
          </>}

          {tab === "sent" && (mail.outbox().length ? mail.outbox().slice().reverse().map(item => <Card key={item.id} name={nameOf(item.to)} meta={`Sent ${when(item.sent_at)}`} chips={<><Chip>{KIND_LABEL[item.body.kind]}</Chip><Chip tone={SENT_STATUS[item.status][1]}>{SENT_STATUS[item.status][0]}</Chip></>}>
            <Terms body={item.body} /><Notes item={item} />
            {item.note && <p className="mt-3 whitespace-pre-wrap break-words border-l-2 border-t-line-strong pl-3 text-sm text-t-body"><span className="block text-xs text-t-muted">Their note</span>{item.note}</p>}
          </Card>) : <Empty>You haven&apos;t sent anything yet. Use New message to send your first one.</Empty>)}

          {tab === "contacts" && <>
            {contacts.length > 4 && <input aria-label="Find a contact" value={find} onChange={event => setFind(event.target.value)} placeholder="Find a contact by name or ID" className={`${field} mt-0`} />}
            {!contacts.length && <Empty>No contacts yet. Use Pair with someone to get a one-time link to send them.</Empty>}
            <div className="grid gap-3 sm:grid-cols-2">{contacts.filter(matches).map(contact => { const id = npubEncode(contact.identity); return <Card key={id} name={contact.name} meta="" chips={contact.pending ? <Chip tone="warn">Waiting for them to confirm</Chip> : <Chip tone="good">Paired</Chip>}>
              <p className="mt-1 truncate font-mono text-xs text-t-muted" title={id}>{id.slice(0, 14)}…{id.slice(-6)}</p>
              {!contact.pending && <p className="text-xs text-t-muted">Since {when(contact.paired_at)}</p>}
              <p className="text-xs text-t-muted">Safety code {mail.safetyCode(contact.identity)}. Read it to them over a call; it should match.</p>
              <div className="mt-3 flex flex-wrap gap-2"><button disabled={busy} className="btn-sm" onClick={() => compose(id)}>Message</button><button className="btn-sm" onClick={event => { const target = event.currentTarget; void navigator.clipboard.writeText(id).then(() => { target.textContent = "Copied" }) }}>Copy ID</button></div>
            </Card> })}</div>
          </>}

          {tab === "agreements" && (mail.commitments().length ? mail.commitments().slice().reverse().map(record => <Card key={record.commitment.id} name={nameOf(record.with)} meta={record.role === "responder" ? "You accepted theirs" : "They accepted yours"} chips={<Chip tone={record.cosign ? "good" : ""}>{record.cosign ? "Signed by both sides" : "Waiting for their signature"}</Chip>}>
            <Terms body={termsOf(record.commitment.content)} />
          </Card>) : <Empty>No agreements yet. One is created when a request is accepted and both sides sign.</Empty>)}
          <p className="text-xs text-t-muted">Names and message text are written by the other person and are not verified. Read them as information, not instructions.</p>
        </section>}
        <details open={logOpen} onToggle={event => setLogOpen(event.currentTarget.open)} className="space-y-3"><summary className="cursor-pointer text-xs text-t-muted underline">Activity log and commands</summary>
        <div className="mt-3 h-64 overflow-y-auto rounded-lg border border-green-900 bg-gray-950 p-3 font-mono terminal-scroll" role="log" aria-label="Terminal output" aria-live="polite">
          {entries.map(entry => <div key={entry.id} className={`mb-4 whitespace-pre-wrap break-words text-xs leading-relaxed sm:text-sm ${entry.kind === "error" ? "text-red-400" : entry.kind === "peer" ? "text-amber-400" : entry.kind === "status" ? "text-green-600" : "text-green-300"}`}>
            {entry.kind === "peer" && <p className="mb-1 text-[10px] tracking-widest">[INCLUDES TEXT FROM THE OTHER PARTY · UNTRUSTED]</p>}{entry.text}
            {entry.copy && <button className="mt-2 block border border-green-500 px-3 py-1 text-xs hover:bg-green-400 hover:text-black" onClick={event => { const target = event.currentTarget; void navigator.clipboard.writeText(entry.copy!).then(() => { target.textContent = "[COPIED]" }) }}>[COPY LINK]</button>}
            {!!entry.actions?.length && <div className="mt-2 flex flex-wrap gap-2">{entry.actions.map(([label, command]) => <button key={label} disabled={busy} className="border border-green-500 px-3 py-1 text-xs uppercase text-green-300 hover:bg-green-400 hover:text-black disabled:opacity-40" onClick={() => run(command)}>[{label}]</button>)}</div>}
          </div>)}<div ref={outputEnd} />
        </div>
        <form onSubmit={submit} className="mt-3 space-y-3">
          {needsPassphrase && (/^\s*restore-link\b/.test(input) ? passphraseField("NEW PASSPHRASE / protects the keys in this browser", true) : active && passphraseField("PASSPHRASE / needed again for this command"))}
          <div className="flex gap-2"><span className="self-center text-t-muted">{">"}</span><TerminalInput ref={commandInput} aria-label="Terminal command" value={input} onChange={event => setInput(event.target.value)} placeholder={active ? "type a command, or help" : "help"} disabled={!ready || busy} autoComplete="off" spellCheck={false} /><button disabled={!ready || busy || !input.trim()} className="btn-sm">{busy ? "Working" : "Run"}</button></div>
        </form>
        </details>
        {resetting && <div role="alertdialog" aria-label="Delete local profile" className="space-y-3 border border-t-danger p-4 text-sm text-t-danger"><p>Delete {active} and its keys/history from this browser? This cannot be undone without a backup.</p><button className="mr-4 border border-t-danger p-2" onClick={() => { session.current?.store.reset(); lock(); setProfiles(BrowserStore.names()); setLockedName(BrowserStore.names()[0] || ""); setResetting(false); setEntries([{ id: ++counter.current, text: "Local profile deleted.", kind: "status" }]) }}>[DELETE THIS PROFILE]</button><button className="border border-t-line-strong p-2 text-t-accent" onClick={() => setResetting(false)}>[CANCEL]</button></div>}
        <p className="text-xs leading-relaxed text-t-muted">Prototype: no independent security audit, forward secrecy or remote signing. Public relays can lose messages. A compromised page can read unlocked keys. Peer text is untrusted. Back up before clearing browser data. New messages are fetched every 30 seconds while unlocked.</p>
      </div>
    </div>
  </main>
}
