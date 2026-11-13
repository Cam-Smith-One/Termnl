import test from "node:test"
import assert from "node:assert/strict"
import {Client} from "@modelcontextprotocol/sdk/client/index.js"
import {StdioClientTransport} from "@modelcontextprotocol/sdk/client/stdio.js"
import {mkdtempSync,rmSync} from "node:fs"
import {join} from "node:path"
import {tmpdir} from "node:os"
import {Termnl} from "../lib/termnl/core"
import {FileStore} from "../cli/store"

test("MCP exposes eight limited tools; authority-granting actions are absent",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"termnl-mcp-"))
 const mail=Termnl.init(new FileStore(dir),{name:"mcp-test",relays:["wss://relay.damus.io"]});mail.close()
 const transport=new StdioClientTransport({command:process.execPath,args:[join(process.cwd(),"dist-cli/mcp.mjs")],env:{PATH:process.env.PATH||"",TERMNL_HOME:dir}})
 const client=new Client({name:"termnl-test",version:"1"})
 try {
  await client.connect(transport)
  const tools=await client.listTools()
  assert.deepEqual(tools.tools.map(tool=>tool.name).sort(),["whoami","list_contacts","check_inbox","send_request","respond","list_outbox","list_commitments","get_log"].sort())
  const rejected=await client.callTool({name:"send_request",arguments:{to:"not-paired",kind:"offer",subject:"Outside mandate",amount:50000,currency:"AUD"}})
  assert.equal(rejected.isError,true)
  assert.match(JSON.stringify(rejected.content),/outside the agent.s mandate/)
 } finally {await client.close();rmSync(dir,{recursive:true,force:true})}
})
