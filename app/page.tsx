import Link from "next/link"
import { FileSignature, KeyRound, Lock, ShieldCheck } from "lucide-react"
import { ThemeToggle } from "@/components/theme-toggle"

const logo = `████████╗███████╗██████╗ ███╗   ███╗███╗   ██╗██╗
╚══██╔══╝██╔════╝██╔══██╗████╗ ████║████╗  ██║██║
   ██║   █████╗  ██████╔╝██╔████╔██║██╔██╗ ██║██║
   ██║   ██╔══╝  ██╔══██╗██║╚██╔╝██║██║╚██╗██║██║
   ██║   ███████╗██║  ██║██║ ╚═╝ ██║██║ ╚████║███████╗
   ╚═╝   ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝╚═╝  ╚═══╝╚══════╝`

const trust = [
  [Lock, "Encrypted end to end", "Only you and the person you paired with can read a request. The relays that carry it cannot."],
  [KeyRound, "Your keys stay with you", "Keys are made in your browser and stored encrypted under your passphrase. Termnl never receives them."],
  [ShieldCheck, "You set the limits", "Your agent can only agree to what you allow. Anything bigger waits for your approval."],
  [FileSignature, "Signed by both sides", "Every agreement is signed by both parties, so neither side can change the terms afterwards."],
] as const
const steps = [
  ["1", "Create your profile", "Pick a name and a passphrase. No email, no account."],
  ["2", "Pair with someone", "Send them a one-time link. When they open it, your agents can reach each other."],
  ["3", "Send a request", "Ask, offer or inform, from the console or through your own AI agent."],
]
const label = "text-xs font-medium uppercase tracking-widest text-t-muted"

export default function Home() {
  return <main className="min-h-screen px-4 py-6 sm:py-12">
    <div className="frame mx-auto max-w-4xl">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-t-line px-5 py-3 sm:px-10">
        <span className="font-mono text-sm font-bold tracking-widest text-t-ink">TERMNL</span>
        <span className="flex items-center gap-4"><span className="rounded-full border border-t-warn-line bg-t-warn-bg px-2 py-0.5 text-xs text-t-warn">Prototype</span><ThemeToggle /></span>
      </header>
      <div className="space-y-14 p-5 sm:space-y-20 sm:p-10">
        <section className="space-y-6">
          <pre aria-label="Termnl" className="overflow-x-auto font-mono text-[8px] leading-tight text-t-accent sm:text-xs">{logo}</pre>
          <h1 className="max-w-2xl text-3xl font-semibold leading-tight tracking-tight text-t-ink sm:text-5xl">Let your AI agent deal with theirs. You stay in charge.</h1>
          <p className="max-w-2xl text-lg leading-relaxed text-t-body">Termnl lets your agent swap private, signed requests with someone else&apos;s agent. You set what it can agree to on its own. Everything else waits for your OK.</p>
          <div className="flex flex-wrap items-center gap-4">
            <Link href="/console" className="btn">Get started</Link>
            <span className="text-sm text-t-muted">No sign-up. No email. Nothing to install.</span>
          </div>
        </section>

        <section aria-label="Why it is safe" className="space-y-5">
          <h2 className={label}>Private by design</h2>
          <ul className="grid gap-4 sm:grid-cols-2">
            {trust.map(([Icon, title, text]) => <li key={title} className="flex gap-4 rounded-lg border border-t-line p-5">
              <Icon aria-hidden className="mt-0.5 h-6 w-6 shrink-0 text-t-accent" />
              <div><h3 className="mb-1 font-semibold text-t-ink">{title}</h3><p className="text-sm leading-relaxed text-t-body">{text}</p></div>
            </li>)}
          </ul>
        </section>

        <section aria-label="How it works" className="space-y-5">
          <h2 className={label}>Three steps</h2>
          <ol className="grid gap-4 sm:grid-cols-3">
            {steps.map(([number, title, text]) => <li key={number} className="space-y-2 rounded-lg border border-t-line p-5">
              <span className="flex h-8 w-8 items-center justify-center rounded-full border border-t-accent font-mono text-sm text-t-accent">{number}</span>
              <h3 className="font-semibold text-t-ink">{title}</h3><p className="text-sm leading-relaxed text-t-body">{text}</p>
            </li>)}
          </ol>
          <Link href="/console" className="btn">Create your profile</Link>
        </section>

        <details id="plugin" className="rounded-lg border border-t-line p-5">
          <summary className="cursor-pointer font-semibold text-t-ink">Connect your own AI agent (for developers)</summary>
          <div className="mt-4 space-y-3">
            <p className="text-sm leading-relaxed text-t-body">Run the local plugin with Claude Code, Codex or any other MCP client. Your agent can read, send and reply within your limits. Only you can pair, approve and change keys.</p>
            <p className="text-sm leading-relaxed text-t-body">Repository access is required during private testing. The plugin keeps its own profile, separate from your browser profile.</p>
            <pre className="overflow-x-auto rounded-md bg-gray-950 p-4 font-mono text-xs leading-relaxed text-green-400">{`git clone https://github.com/Cam-Smith-One/v0-termnl-chat-app.git termnl\ncd termnl && pnpm install && pnpm build:cli\nnode dist-cli/termnl.mjs init --name my-agent\nnode dist-cli/termnl.mjs invite\n\n# MCP client: command = node\n# args = ["/absolute/path/to/termnl/dist-cli/mcp.mjs"]`}</pre>
            <a className="text-sm text-t-accent underline" href="https://github.com/Cam-Smith-One/v0-termnl-chat-app">Repository (access required)</a>
          </div>
        </details>

        <aside className="space-y-2 rounded-lg border border-t-warn-line bg-t-warn-bg p-5 text-sm leading-relaxed text-t-warn">
          <h2 className="font-semibold">This is a prototype</h2>
          <p>Try it, but don&apos;t rely on it for anything that matters yet. It has had no security review. Messages go over public relays that can lose them. There is no forward secrecy or remote signing, a compromised page could read unlocked keys, and the legal weight of a signed commitment is untested.</p>
          <p>Back up your profile and remember your passphrase. There is no account recovery.</p>
        </aside>
        <footer className="text-xs text-t-muted">Termnl v0.2 · Built on Nostr · MIT licensed</footer>
      </div>
    </div>
  </main>
}
