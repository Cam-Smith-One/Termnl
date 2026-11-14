import test from "node:test"
import assert from "node:assert/strict"
import {commandWords,options} from "../lib/termnl/command"
import {Termnl} from "../lib/termnl/core"
import {FileStore} from "../cli/store"
import {decodeInvite,relayList,peerRelayList} from "../lib/termnl/protocol"
import {mkdtempSync,rmSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
test("relays supplied by another party must be public: no local, internal or literal-IP hosts",()=>{
  for(const ok of ["wss://relay.primal.net","wss://termnl.app/relay"]) assert.equal(peerRelayList.safeParse([ok]).success,true,ok)
  for(const bad of ["wss://10.0.0.5:8443/admin","wss://169.254.169.254/","wss://[::1]/","wss://localhost","wss://printer.internal/x","wss://box.local","wss://a.localhost","wss://example.com.","http://example.com"]) assert.equal(peerRelayList.safeParse([bad]).success,false,bad)
  const was=process.env.TERMNL_TEST
  try{ delete process.env.TERMNL_TEST; assert.equal(peerRelayList.safeParse(["ws://127.0.0.1:6379/x"]).success,false) } finally { process.env.TERMNL_TEST=was }
  assert.equal(relayList.safeParse(["ws://127.0.0.1:7447"]).success,true) // the owner's own list may still be local
})
test("browser commands parse quoted text without evaluation",()=>{
  const result=options(commandWords('send bob inform "Hello there" --details "Keep $HOME literal"').slice(1))
  assert.deepEqual(result.args,["bob","inform","Hello there"])
  assert.equal(result.flags.details,"Keep $HOME literal")
  assert.throws(()=>commandWords('send "unfinished'))
})
test("Termnl invites support Unicode names and fragment links",()=>{
  const dir=mkdtempSync(join(tmpdir(),"termnl-invite-"))
  const mail=Termnl.init(new FileStore(dir),{name:"Café 🦘",relays:["wss://relay.damus.io"]})
  try {
    const invite=mail.createInvite()
    assert.ok(invite.startsWith("termnl1:"))
    assert.equal(decodeInvite(`https://termnl.app/pair#${invite}`).name,"Café 🦘")
    assert.throws(()=>mail.createInvite(-1))
  } finally {mail.close();rmSync(dir,{recursive:true,force:true})}
})
test("relay lists enforce encrypted remote transport and bounded connection counts",()=>{
  assert.ok(relayList.safeParse(["ws://127.0.0.1:7447"]).success)
  for(const list of [["ws://example.com"],["https://example.com"],["wss://user:secret@example.com"],Array(9).fill("wss://relay.damus.io")]) assert.equal(relayList.safeParse(list).success,false)
})
