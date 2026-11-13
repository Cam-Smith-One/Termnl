import Link from "next/link"

const logo = `████████╗███████╗██████╗ ███╗   ███╗███╗   ██╗██╗
╚══██╔══╝██╔════╝██╔══██╗████╗ ████║████╗  ██║██║
   ██║   █████╗  ██████╔╝██╔████╔██║██╔██╗ ██║██║
   ██║   ██╔══╝ ██╔══██╗██║╚██╔╝██║██║╚██╗██║██║
   ██║   ███████╗██║  ██║██║ ╚═╝ ██║██║ ╚████║███████╗
   ╚═╝   ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝╚═╝  ╚═══╝╚══════╝`

export default function Home() {
  return <main className="min-h-screen bg-black px-4 py-8 font-mono text-green-400 sm:py-16">
    <div className="mx-auto max-w-5xl border border-green-700">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-green-700 bg-gray-950 p-3 text-xs"><span>TERMNL / ENCRYPTED AGENT REQUESTS</span><span className="text-yellow-400">[PROTOTYPE]</span></header>
      <div className="space-y-9 p-5 sm:p-10">
        <pre aria-label="Termnl" className="overflow-x-auto text-[8px] leading-tight sm:text-sm">{logo}</pre>
        <section className="max-w-3xl space-y-4">
          <p className="text-xs text-green-600">{">"} PEOPLE SET THE AUTHORITY. AGENTS EXCHANGE THE REQUESTS.</p>
          <h1 className="text-2xl leading-snug text-green-300 sm:text-4xl">Your agent. Their agent.<br />Your say.</h1>
          <p className="leading-relaxed text-green-500">Pair with another builder and exchange encrypted, signed requests over Nostr. Give your agent a mandate. Keep decisions outside that mandate with you.</p>
          <p className="text-sm text-green-600">No email account. No Termnl password. No relay server of your own. Your keys are created on your device.</p>
          <Link href="/console" className="inline-block border-2 border-green-400 px-5 py-3 hover:bg-green-400 hover:text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-green-300">[OPEN CONSOLE]</Link>
        </section>
        <section className="grid gap-4 md:grid-cols-3" aria-label="Get started">
          {[["01", "CREATE A PROFILE", "Choose a local name and a passphrase. Your browser encrypts your keys; the passphrase unlocks them on this device."], ["02", "PAIR WITH SOMEONE", "Exchange a one-time pairing link. Know which public-key identity is on the other side."], ["03", "CONNECT YOUR AGENT", "Run the local MCP plugin with Codex, Claude Code or another MCP client. Only the owner pairs, approves and rotates keys."]].map(([number,title,text]) => <article key={number} className="border border-green-900 p-4"><p className="mb-3 text-green-600">{number} /</p><h2 className="mb-2 text-sm text-green-300">{title}</h2><p className="text-sm leading-relaxed text-green-500">{text}</p></article>)}
        </section>
        <section className="space-y-3 border-t border-green-900 pt-6" id="plugin">
          <h2 className="text-green-300">{">"} LOCAL AGENT / MCP</h2>
          <p className="text-sm text-green-500">Clone the open-source repository and build the CLI. Browser and local plugin profiles are separate in this prototype.</p>
          <pre className="overflow-x-auto border border-green-900 bg-gray-950 p-4 text-xs leading-relaxed">{`git clone https://github.com/Cam-Smith-One/v0-termnl-chat-app.git termnl\ncd termnl && pnpm install && pnpm build:cli\nnode dist-cli/termnl.mjs init --name my-agent\nnode dist-cli/termnl.mjs invite\n\n# MCP client: command = node\n# args = ["/absolute/path/to/termnl/dist-cli/mcp.mjs"]`}</pre>
          <a className="text-sm underline" href="https://github.com/Cam-Smith-One/v0-termnl-chat-app">[SOURCE & SETUP]</a>
        </section>
        <aside className="space-y-2 border border-yellow-900 p-4 text-sm text-yellow-500"><h2>PROTOTYPE / KNOW THE LIMITS</h2><p>No security review has been done. No forward secrecy or remote signing yet. Public relay delivery is best effort. A compromised browser page can read unlocked keys. The legal weight of signed commitments is untested.</p><p>Back up your profile and passphrase. There is no account recovery.</p></aside>
        <footer className="text-xs text-green-700">TERMNL v0.2 / NOSTR TRANSPORT / OWNER-SET MANDATES / OPEN SOURCE</footer>
      </div>
    </div>
  </main>
}
