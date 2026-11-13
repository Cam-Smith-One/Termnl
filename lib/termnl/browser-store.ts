import { encrypt, decrypt } from "nostr-tools/nip49"
import { bytesToHex, hexToBytes } from "nostr-tools/utils"
import { getPublicKey } from "nostr-tools/pure"
import type { Store } from "./store"
import { certValid } from "./core"
import { bech32 } from "@scure/base"
import { relayList, mandate } from "./protocol"

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">
type Snapshot = { version: 1; files: Record<string, unknown> }
const secretFiles = new Set(["identity.key", "agent.json"])
function validateCiphertext(value: string) {
  try {
    if (typeof value !== "string" || !value.startsWith("ncryptsec1") || value.length > 500) throw new Error()
    const decoded = bech32.decode(value as `${string}1${string}`, 500)
    const bytes = bech32.fromWords(decoded.words)
    if (decoded.prefix !== "ncryptsec" || bytes.length !== 91 || bytes[0] !== 2 || bytes[1] < 16 || bytes[1] > 18) throw new Error()
  } catch {
    throw new Error("Unsupported encrypted key or excessive key-derivation cost")
  }
}
const clone = <T>(value: T): T => value === undefined ? value : JSON.parse(JSON.stringify(value))
export const profileName = (name: string) => {
  if (!/^[a-zA-Z0-9_-]{1,32}$/.test(name)) throw new Error("Profile name must be 1–32 letters, numbers, _ or -")
  return name
}

/** Only NIP-49 ciphertext is persisted for secret keys. The identity secret is
 * opened only inside withIdentity(), for rotation or an owner-signed claim. */
export class BrowserStore implements Store {
  readonly dir: string
  private secrets = new Map<string, unknown>()
  private password: string | null = null
  private files: Record<string, unknown>
  private unlocked = false

  constructor(readonly name: string, private storage: StorageLike = localStorage) {
    this.dir = `termnl:${profileName(name)}`
    const saved = storage.getItem(this.dir)
    const snapshot = saved ? JSON.parse(saved) as Snapshot : { version: 1, files: {} }
    if (snapshot.version !== 1 || !snapshot.files || typeof snapshot.files !== "object") throw new Error("Unsupported profile backup")
    this.files = snapshot.files as Record<string, unknown>
  }
  static names(storage: StorageLike = localStorage): string[] {
    return Array.from({ length: storage.length }, (_, index) => storage.key(index) || "")
      .filter(key => /^termnl:[a-zA-Z0-9_-]{1,32}$/.test(key)).map(key => key.slice(7)).sort()
  }
  static restore(name: string, serialized: string, storage: StorageLike = localStorage) {
    const key = `termnl:${profileName(name)}`
    if (storage.getItem(key)) throw new Error("Choose a new local name; an existing profile will not be overwritten")
    if (serialized.length > 5 * 1024 * 1024) throw new Error("Backup is too large")
    let snapshot: Snapshot
    try { snapshot = JSON.parse(serialized) } catch { throw new Error("Backup is not valid JSON") }
    if (snapshot.version !== 1 || !snapshot.files) throw new Error("Unsupported profile backup")
    for (const file of secretFiles) {
      const item = snapshot.files[file] as { sk?: string }
      if (!item?.sk) throw new Error("Backup must contain encrypted identity and agent keys")
      validateCiphertext(item.sk)
    }
    const config = snapshot.files["config.json"] as { identity: string; relays: string[] }
    if (!/^[0-9a-f]{64}$/.test(config?.identity)) throw new Error("Invalid backup identity")
    relayList.parse(config.relays); mandate.parse(snapshot.files["mandate.json"])
    storage.setItem(key, JSON.stringify(snapshot))
  }
  beginSetup(password: string) {
    if (this.has("config.json")) throw new Error("Profile already exists; use unlock")
    if (password.length < 10) throw new Error("Use a passphrase of at least 10 characters")
    this.password = password
    this.unlocked = true
  }
  finishSetup() { this.password = null; this.secrets.delete("identity.key") }
  unlock(password: string) {
    this.lock()
    try {
      const encrypted = this.files["agent.json"] as { sk: string; cert: Parameters<typeof certValid>[0] }
      if (!encrypted?.sk?.startsWith("ncryptsec1")) throw new Error("Missing encrypted agent key")
      validateCiphertext(encrypted.sk)
      const sk = decrypt(encrypted.sk, password)
      try {
        const config = this.read<{ identity: string }>("config.json", { identity: "" })
        if (!certValid(encrypted.cert, config.identity, getPublicKey(sk), 0)) throw new Error("Invalid agent certificate")
        this.secrets.set("agent.json", { ...encrypted, sk: bytesToHex(sk) })
        this.unlocked = true
      } finally { sk.fill(0) }
    } catch { this.lock(); throw new Error("Could not unlock. Check the passphrase and profile backup.") }
  }
  async withIdentity<T>(password: string, action: () => T | Promise<T>): Promise<T> {
    if (!this.unlocked) throw new Error("Unlock the profile first")
    let sk: Uint8Array | undefined
    try {
      const encrypted = this.files["identity.key"] as { sk: string }
      validateCiphertext(encrypted.sk)
      sk = decrypt(encrypted.sk, password)
      const config = this.read<{ identity: string }>("config.json", { identity: "" })
      if (getPublicKey(sk) !== config.identity) throw new Error("Identity does not match")
      this.secrets.set("identity.key", { sk: bytesToHex(sk) })
      this.password = password
      return await action()
    } finally { sk?.fill(0); this.secrets.delete("identity.key"); this.password = null }
  }
  lock() { this.secrets.clear(); this.password = null; this.unlocked = false }
  has(name: string) { return Object.hasOwn(this.files, name) }
  read<T>(name: string, fallback: T): T {
    if (!this.has(name)) return clone(fallback)
    if (secretFiles.has(name)) {
      if (!this.unlocked || !this.secrets.has(name)) throw new Error(name === "identity.key" ? "Re-enter your passphrase for this owner action" : "Profile is locked")
      return clone(this.secrets.get(name) as T)
    }
    return clone(this.has(name) ? this.files[name] as T : fallback)
  }
  write(name: string, value: unknown, secret = false) {
    if (!this.unlocked) throw new Error("Profile is locked")
    const next = { ...this.files }
    if (secret || secretFiles.has(name)) {
      if (!secretFiles.has(name) || !this.password) throw new Error("Re-enter your passphrase to encrypt a key")
      const key = value as { sk: string; cert?: unknown }
      const bytes = hexToBytes(key.sk)
      try { next[name] = { ...key, sk: encrypt(bytes, this.password, 16) } } finally { bytes.fill(0) }
    } else next[name] = clone(value)
    this.storage.setItem(this.dir, JSON.stringify({ version: 1, files: next }))
    this.files = next
    if (secretFiles.has(name)) this.secrets.set(name, clone(value))
  }
  append(name: string, value: unknown) {
    this.write(name, [...this.read<unknown[]>(name, []), value].slice(-1000))
  }
  lines<T>(name: string, last = 50): T[] { return this.read<T[]>(name, []).slice(-last) }
  backup(): string { return JSON.stringify({ version: 1, files: this.files }, null, 2) }
  reset() { this.lock(); this.storage.removeItem(this.dir); this.files = {} }
}
