import test from "node:test"
import assert from "node:assert/strict"
import WebSocket from "ws"
import {useWebSocketImplementation as installWebSocket} from "nostr-tools/pool"
import {mkdtempSync,rmSync} from "node:fs"
import {join} from "node:path"
import {tmpdir} from "node:os"
import {Termnl} from "../lib/termnl/core"
import {FileStore} from "../cli/store"
import {startRelay} from "./relay"
installWebSocket(WebSocket)
test("NIP-42 relays authenticate query and publish with the agent key",async()=>{
 const relay=startRelay(7448,true),dir=mkdtempSync(join(tmpdir(),"termnl-auth-"))
 const a=Termnl.init(new FileStore(join(dir,"a")),{name:"a",relays:[relay.url]})
 const b=Termnl.init(new FileStore(join(dir,"b")),{name:"b",relays:[relay.url]})
 try {
  await a.acceptInvite(b.createInvite())
  assert.equal((await b.sync()).processed,1)
  await a.sync()
  const request=await a.sendRequest("b",{kind:"inform",subject:"Authenticated relay test"})
  await b.sync()
  assert.ok(b.inbox().some(item=>item.id===request.id))
  assert.ok(relay.authenticated.includes(a.agentPub))
  assert.ok(relay.authenticated.includes(b.agentPub))
 } finally {a.close();b.close();await relay.stop();rmSync(dir,{recursive:true,force:true})}
})
