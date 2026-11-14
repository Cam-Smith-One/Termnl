import test from "node:test"
import assert from "node:assert/strict"
import {Client} from "@modelcontextprotocol/sdk/client/index.js"
import {StdioClientTransport} from "@modelcontextprotocol/sdk/client/stdio.js"
import {mkdtempSync,rmSync} from "node:fs"
import {join} from "node:path"
import {tmpdir} from "node:os"
import {Termnl} from "../lib/termnl/core"
import {FileStore} from "../cli/store"
import {WebSocketServer} from "ws"

test("MCP exposes ten limited tools; authority-granting actions are absent",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"termnl-mcp-"))
 const mail=Termnl.init(new FileStore(dir),{name:"mcp-test",relays:["wss://relay.damus.io"]});mail.close()
 const transport=new StdioClientTransport({command:process.execPath,args:[join(process.cwd(),"dist-cli/mcp.mjs")],env:{PATH:process.env.PATH||"",TERMNL_HOME:dir}})
 const client=new Client({name:"termnl-test",version:"1"})
 try {
  await client.connect(transport)
  const tools=await client.listTools()
  assert.deepEqual(tools.tools.map(tool=>tool.name).sort(),["whoami","list_contacts","check_inbox","send_request","respond","list_outbox","list_commitments","get_log","inbox_check_interval","save_attachments"].sort())
  // Inbox and sent carry the chat card; the card page is served and never builds HTML from peer text.
  for(const name of ["check_inbox","list_outbox"]) assert.equal((tools.tools.find(t=>t.name===name)!._meta as any).ui.resourceUri,"ui://termnl/messages.html")
  const page=(await client.readResource({uri:"ui://termnl/messages.html"})).contents[0] as {mimeType:string;text:string}
  assert.equal(page.mimeType,"text/html;profile=mcp-app"); assert.doesNotMatch(page.text,/innerHTML|document\.write/)
  // The agent cannot attach files unless the owner's mandate allows it.
  const refused=await client.callTool({name:"send_request",arguments:{to:"nobody",kind:"inform",subject:"x",files:["/etc/hosts"]}})
  assert.equal(refused.isError,true); assert.match(JSON.stringify(refused.content),/not allowed to send files/)
  const rejected=await client.callTool({name:"send_request",arguments:{to:"not-paired",kind:"offer",subject:"Outside mandate",amount:50000,currency:"AUD"}})
  assert.equal(rejected.isError,true)
  assert.match(JSON.stringify(rejected.content),/outside the agent.s mandate/)
  assert.match(JSON.stringify((await client.callTool({name:"inbox_check_interval",arguments:{}})).content),/inbox_check_minutes[^0-9]+15/)
  assert.match(JSON.stringify((await client.callTool({name:"inbox_check_interval",arguments:{minutes:60}})).content),/inbox_check_minutes[^0-9]+60/)
  assert.equal((await client.callTool({name:"inbox_check_interval",arguments:{minutes:1}})).isError,true)
 } finally {await client.close();rmSync(dir,{recursive:true,force:true})}
})

test("MCP offers a local card panel without UI support and preserves native MCP Apps", async () => {
 const relay = new WebSocketServer({host:"127.0.0.1",port:0})
 await new Promise<void>(resolve=>relay.once("listening",resolve))
 relay.on("connection",socket=>socket.on("message",data=>{
  const message=JSON.parse(data.toString())
  if(message[0]==="REQ") socket.send(JSON.stringify(["EOSE",message[1]]))
 }))
 const address=relay.address()
 assert.ok(address && typeof address!=="string")
 try {
  for(const native of [false,true]) {
   const dir=mkdtempSync(join(tmpdir(),"termnl-cards-"))
   const mail=Termnl.init(new FileStore(dir),{name:"card-test",relays:[`ws://127.0.0.1:${address.port}`]});mail.close()
   const transport=new StdioClientTransport({command:process.execPath,args:[join(process.cwd(),"dist-cli/mcp.mjs")],env:{PATH:process.env.PATH||"",TERMNL_HOME:dir}})
   const client=new Client({name:"card-test",version:"1"},{capabilities:native?{extensions:{"io.modelcontextprotocol/ui":{mimeTypes:["text/html;profile=mcp-app"]}}}:{}})
   try {
    await client.connect(transport)
    const result=await client.callTool({name:"check_inbox",arguments:{}})
    assert.ok(!result.isError)
    const data=JSON.parse((result.content as {type:string;text:string}[])[0].text)
    assert.deepEqual(data.requests,[])
    if(native) {
     assert.ok(data.card_shown)
     assert.equal(data.card_view,undefined)
    } else {
     assert.equal(data.card_shown,undefined)
     assert.match(data.card_view.url,/^http:\/\/127\.0\.0\.1:/)
     const response=await fetch(data.card_view.url)
     assert.equal(response.status,200)
     assert.match(await response.text(),/Buttons copy a request to paste into the chat/)
    }
   } finally {await client.close();await transport.close();rmSync(dir,{recursive:true,force:true})}
  }
 } finally {relay.clients.forEach(socket=>socket.terminate());await new Promise<void>((resolve,reject)=>relay.close(e=>e?reject(e):resolve()))}
})
