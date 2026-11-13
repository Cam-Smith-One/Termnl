import test from "node:test"
import assert from "node:assert/strict"
import { BrowserStore } from "../lib/termnl/browser-store"
import { Termnl } from "../lib/termnl/core"

class MemoryStorage {
  values = new Map<string,string>()
  get length() { return this.values.size }
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string,value: string) { this.values.set(key,value) }
  removeItem(key: string) { this.values.delete(key) }
  key(index: number) { return [...this.values.keys()][index] ?? null }
}
test("browser keys persist as NIP-49 ciphertext; lock/reload/unlock keeps identity", async () => {
  const storage = new MemoryStorage(), passphrase = "test passphrase used only in memory"
  const store = new BrowserStore("alice",storage)
  store.beginSetup(passphrase)
  const mail = Termnl.init(store,{name:"alice",relays:["wss://relay.damus.io"]})
  const original = mail.whoami()
  const agent = store.read<{sk:string}>("agent.json",null as never)
  store.finishSetup()
  const saved = storage.getItem("termnl:alice")!
  assert.ok(saved.includes("ncryptsec1"))
  assert.ok(!saved.includes(agent.sk), "Plain agent key must never be persisted")
  assert.ok(!saved.includes(passphrase), "Passphrase must never be persisted")
  assert.throws(()=>store.read("identity.key",null),/Re-enter/)
  mail.close();store.lock()
  assert.throws(()=>store.read("agent.json",null),/locked/)
  const reloaded = new BrowserStore("alice",storage)
  assert.throws(()=>reloaded.unlock("wrong passphrase"),/Could not unlock/)
  reloaded.unlock(passphrase)
  assert.throws(()=>reloaded.read("identity.key",null),/Re-enter/)
  const opened = new Termnl(reloaded)
  assert.equal(opened.whoami().identity,original.identity)
  assert.equal(opened.whoami().agent_key,original.agent_key)
  await reloaded.withIdentity(passphrase,()=>opened.rotateAgentKey())
  assert.notEqual(opened.whoami().agent_key,original.agent_key)
  assert.throws(()=>reloaded.read("identity.key",null),/Re-enter/)
  opened.close();reloaded.lock()
  reloaded.unlock(passphrase)
  const rotated = new Termnl(reloaded)
  assert.notEqual(rotated.whoami().agent_key,original.agent_key)
  const backup = reloaded.backup()
  BrowserStore.restore("restored",backup,storage)
  const restored = new BrowserStore("restored",storage);restored.unlock(passphrase)
  assert.equal(new Termnl(restored).whoami().identity,original.identity)
  assert.throws(()=>BrowserStore.restore("restored",backup,storage),/overwritten/)
  rotated.close();reloaded.reset();restored.reset()
  assert.equal(storage.length,0)
})
test("profile names cannot escape the storage namespace",()=>{
  const storage=new MemoryStorage()
  assert.throws(()=>new BrowserStore("../other",storage))
  assert.throws(()=>new BrowserStore("__proto__/x",storage))
})
