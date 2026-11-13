import test from "node:test"
import assert from "node:assert/strict"
import { generateSecretKey, getPublicKey, finalizeEvent } from "nostr-tools/pure"
import { minePow } from "nostr-tools/nip13"
import { handleName, handleTemplate, validateHandleClaim, HANDLE_DIFFICULTY } from "../lib/termnl/handles"

test("handles reject reserved names, unsafe lengths and query syntax",()=>{
  for(const name of ["admin","termnl","a","AName","bad.name","a,b","_name","x".repeat(21)]) assert.equal(handleName.safeParse(name).success,false)
  for(const name of ["cam","cam-smith","cam_smith","123"]) assert.equal(handleName.safeParse(name).success,true)
})
test("claim binds name, relays, URL and fresh timestamp to a real signature and PoW",()=>{
  const sk=generateSecretKey(),payload={name:"alice",relays:["wss://relay.damus.io"]}
  const url="https://termnl.app/api/handles"
  const work=minePow({...handleTemplate(payload,url),pubkey:getPublicKey(sk)},HANDLE_DIFFICULTY)
  const event=finalizeEvent(work,sk)
  const claim={...payload,event}
  assert.equal(validateHandleClaim(claim,url).name,"alice")
  assert.throws(()=>validateHandleClaim({...claim,name:"mallory"},url),/payload/)
  assert.throws(()=>validateHandleClaim(claim,"https://other.invalid/api/handles"),/URL/)
  assert.throws(()=>validateHandleClaim(claim,url,event.created_at+61),/expired/)
  assert.throws(()=>validateHandleClaim({...claim,event:{...event,sig:"0".repeat(128)}},url),/signature/)
  const noWork=finalizeEvent({...handleTemplate(payload,url),tags:[...handleTemplate(payload,url).tags,["nonce","0","0"]]},sk)
  assert.throws(()=>validateHandleClaim({...payload,event:noWork},url),/proof of work/)
  sk.fill(0)
})
