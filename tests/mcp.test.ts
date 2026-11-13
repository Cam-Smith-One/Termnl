import test from "node:test"
import assert from "node:assert/strict"
import {Client} from "@modelcontextprotocol/sdk/client/index.js"
import {StdioClientTransport} from "@modelcontextprotocol/sdk/client/stdio.js"
import {mkdtempSync,rmSync} from "node:fs"
import {join} from "node:path"
import {tmpdir} from "node:os"
import {Termnl} from "../lib/termnl/core"
import {FileStore} from "../cli/store"

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
