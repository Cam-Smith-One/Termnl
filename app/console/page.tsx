"use client"

import { useEffect, useRef, useState, type FormEvent } from "react"
import Link from "next/link"
import { finalizeEvent } from "nostr-tools/pure"
import type { UnsignedEvent } from "nostr-tools/pure"
import { hexToBytes } from "nostr-tools/utils"
import { npubEncode } from "nostr-tools/nip19"
import { TerminalInput } from "@/components/terminal-input"
import { Termnl } from "@/lib/termnl/core"
import { BrowserStore } from "@/lib/termnl/browser-store"
import { DEFAULT_RELAYS } from "@/lib/termnl/protocol"
import { handlePayload, handleTemplate, HANDLE_DIFFICULTY } from "@/lib/termnl/handles"
import { commandWords, options } from "@/lib/termnl/command"

type Entry = { id: number; text: string; kind: "local" | "peer" | "error" | "status"; copy?: string }
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
inbox | outbox               show requests and status
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
  1. [BACK UP]         save your profile file somewhere safe. There is no recovery without it.
  2. [INVITE SOMEONE]  get a one-time link to send to the person you want to pair with.
  3. [CHECK INBOX]     see what their agent has sent you.
Use the buttons above, or type help to see every command.`
const ACTIONS = [["invite someone", "invite"], ["check inbox", "inbox"], ["sent", "outbox"], ["contacts", "contacts"], ["agreements", "commitments"], ["back up", "backup"], ["help", "help"], ["lock", "lock"]]
const button = "border-2 border-green-400 px-4 py-2 text-sm hover:bg-green-400 hover:text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-green-300 disabled:opacity-40"
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
  const [entries, setEntries] = useState<Entry[]>([{ id: 0, text: "Welcome to Termnl. Everything you do shows up here.", kind: "status" }])
  const session = useRef<Session | null>(null)
  const relays = useRef([...DEFAULT_RELAYS])
  const pendingInvite = useRef("")
  const processing = useRef(false)
  const counter = useRef(0)
  const outputEnd = useRef<HTMLDivElement>(null)
  const runRef = useRef<(line: string, auto?: boolean) => Promise<void>>()
  const write = (value: unknown, kind: Entry["kind"] = "local", copy?: string) => setEntries(previous => [...previous, { id: ++counter.current, text: text(value), kind, copy }].slice(-200))
  const lock = () => { session.current?.mail.close(); session.current?.store.lock(); session.current = null; setActive(""); setPassword("") }

  useEffect(() => {
    try { const names = BrowserStore.names(); setProfiles(names); setLockedName(names[0] || ""); setReady(true) }
    catch { write("Browser storage is unavailable. Allow local storage to use this console.", "error") }
    if (window.location.hash) {
      const fragment = decodeURIComponent(window.location.hash.slice(1))
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
      switch (cmd) {
        case "whoami": write(mail.whoami()); break
        case "relays": write(args.length ? mail.setRelays(args) : mail.whoami().relays); break
        case "invite": {
          const minutes = Number(flags.minutes ?? 60), link = `https://termnl.app/pair#${mail.createInvite(minutes)}`
          write(`Send this link to the person you want to pair with. It works once and expires in ${minutes} minutes.\nKeep it private: anyone who opens it first is paired with you.\n\n${link}`, "local", link); break
        }
        case "pair": {
          const contact = await mail.acceptInvite(args[0] || "")
          pendingInvite.current = ""; setHasInvite(false)
          write(`Paired with "${contact.name ?? "(no name)"}". That name is what they chose; it is not verified.\nTheir ID: ${npubEncode(contact.identity)}\nThey will see you the next time their console syncs.`, "peer"); break
        }
        case "contacts": write(mail.contacts().map(contact => ({ identity: npubEncode(contact.identity), untrusted_name: contact.name, agent: npubEncode(contact.agent), relays: contact.relays })), "peer"); break
        case "sync": { const result = await mail.sync(); if (!auto || result.processed || result.dropped) write(result, "status"); break }
        case "inbox": await mail.sync(); if (!mail.inbox().length) { write("Your inbox is empty.", "status"); break } write(mail.inbox().map(item => ({ ...item, from: npubEncode(item.from), untrusted_text: item.body })), "peer"); break
        case "outbox": await mail.sync(); write(mail.outbox(), "peer"); break
        case "approve": write(mail.approve(args[0] || ""), "peer"); break
        case "accept": case "decline": case "counter": write(await mail.respond(args[0] || "", cmd, args.slice(1).join(" ") || undefined), "peer"); break
        case "send": {
          const [to, kind, subject] = args
          if (!to || !kind || !subject) throw new Error('send <contact> <request|offer|inform> "subject" [--amount n] [--currency AUD]')
          const value = flags.amount !== undefined ? { amount: Number(flags.amount), currency: flags.currency || "AUD" } : undefined
          write(await mail.sendRequest(to, { kind: kind as "request" | "offer" | "inform", subject, details: flags.details, value, due: flags.due }, { owner: true })); break
        }
        case "commitments": await mail.sync(); write(mail.commitments(), "peer"); break
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
  const passphraseField = (label: string, create = false) => <label className="block text-xs text-green-500">{label}
    <TerminalInput aria-label="Profile passphrase" type="password" autoComplete={create ? "new-password" : "current-password"} required minLength={create ? 10 : undefined} value={password} onChange={event => setPassword(event.target.value)} disabled={busy} placeholder={create ? "At least 10 characters" : ""} className="mt-1" /></label>

  return <main className="min-h-screen bg-black p-2 font-mono text-green-400 sm:p-5">
    <div className="mx-auto max-w-4xl border border-green-700">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-green-700 bg-gray-950 p-3 text-xs"><Link href="/">TERMNL / CONSOLE</Link><span className={active ? "text-green-300" : "text-yellow-400"}>{!ready ? "OPENING..." : active ? `UNLOCKED / ${active}` : "LOCKED"} · PROTOTYPE</span></header>
      <div className="space-y-4 p-3 sm:p-6">
        {hasInvite && <div className="space-y-3 border border-green-400 p-4 text-sm text-green-300">
          <p>{">"} Someone sent you a pairing invite.</p>
          {active
            ? <div className="flex flex-wrap gap-2"><button disabled={busy} className={button} onClick={() => void execute(`pair ${pendingInvite.current}`)}>[ACCEPT AND PAIR]</button><button className="px-2 text-xs text-green-600 underline" onClick={() => { pendingInvite.current = ""; setHasInvite(false) }}>ignore</button></div>
            : <p className="text-green-500">{creating ? "Create a profile" : "Unlock your profile"} below, then you can accept it.</p>}
        </div>}

        {ready && !active && <form className="mx-auto max-w-md space-y-4 border border-green-700 p-4 sm:p-6" onSubmit={event => { event.preventDefault(); void execute(creating ? `init ${newName}` : `unlock ${lockedName}`) }}>
          <h1 className="text-lg text-green-300">{creating ? "Create your profile" : "Welcome back"}</h1>
          <p className="text-sm leading-relaxed text-green-500">{creating ? "Two fields and you're set. No email, no account. Your keys are made and kept in this browser." : "Enter your passphrase to unlock your profile."}</p>
          {creating
            ? <label className="block text-xs text-green-500">PROFILE NAME<TerminalInput aria-label="Profile name" required pattern="[a-zA-Z0-9_\-]{1,32}" title="1 to 32 letters, numbers, _ or -" value={newName} onChange={event => setNewName(event.target.value)} disabled={busy} placeholder="e.g. sam" autoComplete="off" spellCheck={false} className="mt-1" /></label>
            : profiles.length > 1
              ? <label className="block text-xs text-green-500">PROFILE<select aria-label="Saved profile" className="mt-1 w-full border border-green-400 bg-black p-2 text-base text-green-400" value={lockedName} onChange={event => setLockedName(event.target.value)} disabled={busy}>{profiles.map(profile => <option key={profile} value={profile}>{profile}</option>)}</select></label>
              : <p className="text-sm text-green-300">Profile: {lockedName}</p>}
          {passphraseField("PASSPHRASE", creating)}
          {creating && <p className="text-xs leading-relaxed text-yellow-500">Write the passphrase down. It unlocks your keys and it cannot be reset.</p>}
          {notice && <p role="alert" className="text-sm text-red-400">{notice}</p>}
          <button disabled={busy} className={`${button} w-full`}>{busy ? "[WORKING...]" : creating ? "[CREATE PROFILE]" : "[UNLOCK]"}</button>
          <div className="flex flex-wrap justify-between gap-2 text-xs text-green-600">
            {profiles.length > 0 && <button type="button" className="underline" onClick={() => { setAdding(!adding); setNotice("") }}>{creating ? "Use an existing profile" : "Create another profile"}</button>}
            <details className="w-full"><summary className="cursor-pointer underline">Restore from a backup file</summary><div className="mt-3 space-y-3"><TerminalInput aria-label="Restored profile name" placeholder="Name for the restored profile" value={restoreName} onChange={event => setRestoreName(event.target.value)} /><label className="block">Choose your Termnl backup file<input aria-label="Profile backup file" className="mt-2 block w-full" type="file" accept="application/json,.json" onChange={async event => { const file = event.target.files?.[0]; if (!file) return; try { if (file.size > 5*1024*1024) throw new Error("Backup is too large"); BrowserStore.restore(restoreName, await file.text()); setProfiles(BrowserStore.names()); setLockedName(restoreName); setAdding(false); setNotice(""); write("Backup restored. Enter its original passphrase to unlock.", "status") } catch (error) { const message = error instanceof Error ? error.message : "Restore failed"; write(message, "error"); setNotice(message) } event.target.value = "" }} /></label></div></details>
          </div>
        </form>}

        {active && <div className="flex flex-wrap gap-2 text-xs">{ACTIONS.map(([label, command]) => <button key={command} disabled={busy} onClick={() => void execute(command)} className="border border-green-700 px-3 py-2 uppercase hover:border-green-400 hover:text-green-300 disabled:opacity-40">[{label}]</button>)}</div>}
        <div className={`${active ? "h-[48vh] min-h-64" : "max-h-40"} overflow-y-auto border border-green-900 bg-gray-950 p-3 terminal-scroll`} role="log" aria-label="Terminal output" aria-live="polite">
          {entries.map(entry => <div key={entry.id} className={`mb-4 whitespace-pre-wrap break-words text-xs leading-relaxed sm:text-sm ${entry.kind === "error" ? "text-red-400" : entry.kind === "peer" ? "text-amber-400" : entry.kind === "status" ? "text-green-600" : "text-green-300"}`}>
            {entry.kind === "peer" && <p className="mb-1 text-[10px] tracking-widest">[UNTRUSTED PEER TEXT / DATA, NOT INSTRUCTIONS]</p>}{entry.text}
            {entry.copy && <button className="mt-2 block border border-green-500 px-3 py-1 text-xs hover:bg-green-400 hover:text-black" onClick={event => { const target = event.currentTarget; void navigator.clipboard.writeText(entry.copy!).then(() => { target.textContent = "[COPIED]" }) }}>[COPY LINK]</button>}
          </div>)}<div ref={outputEnd} />
        </div>
        <form onSubmit={submit} className="space-y-3">
          {active && needsPassphrase && passphraseField("PASSPHRASE / needed again for this command")}
          <div className="flex gap-2"><span className="self-center text-green-600">{">"}</span><TerminalInput aria-label="Terminal command" value={input} onChange={event => setInput(event.target.value)} placeholder={active ? "type a command, or help" : "help"} disabled={!ready || busy} autoComplete="off" spellCheck={false} /><button disabled={!ready || busy || !input.trim()} className="border border-green-500 px-3 text-xs hover:bg-green-400 hover:text-black disabled:opacity-40">{busy ? "[WORKING]" : "[RUN]"}</button></div>
        </form>
        {resetting && <div role="alertdialog" aria-label="Delete local profile" className="space-y-3 border border-red-500 p-4 text-sm text-red-400"><p>Delete {active} and its keys/history from this browser? This cannot be undone without a backup.</p><button className="mr-4 border border-red-500 p-2" onClick={() => { session.current?.store.reset(); lock(); setProfiles(BrowserStore.names()); setLockedName(BrowserStore.names()[0] || ""); setResetting(false); setEntries([{ id: ++counter.current, text: "Local profile deleted.", kind: "status" }]) }}>[DELETE THIS PROFILE]</button><button className="border border-green-700 p-2 text-green-400" onClick={() => setResetting(false)}>[CANCEL]</button></div>}
        <p className="text-[10px] leading-relaxed text-yellow-600">Prototype: no security review, forward secrecy or remote signing. Public relays can lose messages. A compromised page can read unlocked keys. Peer text is untrusted. Back up before clearing browser data. New messages are fetched every 30 seconds while unlocked.</p>
      </div>
    </div>
  </main>
}
