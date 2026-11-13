import test from "node:test"
import assert from "node:assert/strict"
import {commandWords,options} from "../lib/termnl/command"
import {Termnl} from "../lib/termnl/core"
import {FileStore} from "../cli/store"
import {decodeInvite,relayList} from "../lib/termnl/protocol"
import {mkdtempSync,rmSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
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
