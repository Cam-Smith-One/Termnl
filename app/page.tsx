import Link from "next/link"
import { ArrowRight, Bot, FileSignature, KeyRound, Lock, Radio, ShieldCheck } from "lucide-react"
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
  ["3", "Send a request", "Fill in a short form in the console, or let your own AI agent do it."],
]
const journey = [
  [Bot, "Your agent", "Writes the request, signs it and locks it on your device."],
  [Radio, "Relay", "Passes on a sealed envelope. It cannot open it or change it."],
  [Bot, "Their agent", "Unlocks it on their device and checks it really came from you."],
] as const
const agentSteps = [
  ["Get the plugin", "Repository access is required during private testing. Needs Node 22.18+ and pnpm.", "git clone https://github.com/Cam-Smith-One/v0-termnl-chat-app.git termnl && cd termnl && pnpm install && pnpm build:cli"],
  ["Create your agent's profile", "This makes the agent its own keys on your machine. It is separate from your browser profile.", "node dist-cli/termnl.mjs init --name my-agent"],
  ["Add it to your agent", "Claude Code is shown. For Codex, use codex mcp add termnl with the same node command. Any other MCP client works the same way.", "claude mcp add --scope user termnl -- node /absolute/path/to/termnl/dist-cli/mcp.mjs"],
  ["Pair it with someone", "This prints a one-time link. Send it to them, or open it yourself in the console to pair your agent with your browser profile.", "node dist-cli/termnl.mjs invite"],
  ["Just ask", "Restart your agent, then talk to it normally.", "\"Check my Termnl inbox.\"\n\"Send Alex a request to review the draft by Friday.\""],
]
const code = "overflow-x-auto rounded-md bg-gray-950 p-4 font-mono text-xs leading-relaxed text-green-400"
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

        <section aria-label="What happens to a request" className="space-y-5">
          <h2 className={label}>What happens to a request</h2>
          <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
            {journey.map(([Icon, title, text], index) => <div key={title} className="contents">
              {index > 0 && <div className="flex shrink-0 items-center justify-center gap-1 text-t-accent"><Lock aria-hidden className="h-4 w-4" /><ArrowRight aria-hidden className="h-5 w-5 rotate-90 sm:rotate-0" /></div>}
              <div className={`flex-1 space-y-2 rounded-lg border p-5 text-center ${index === 1 ? "border-dashed border-t-line-strong" : "border-t-accent"}`}>
                <Icon aria-hidden className="mx-auto h-7 w-7 text-t-accent" />
                <h3 className="font-semibold text-t-ink">{title}</h3><p className="text-sm leading-relaxed text-t-body">{text}</p>
              </div>
            </div>)}
          </div>
          <div className="grid gap-4 text-sm leading-relaxed sm:grid-cols-2">
            <p className="rounded-lg border border-t-line p-4 text-t-body"><strong className="text-t-ink">The relay cannot see</strong> what the request says or who sent it.</p>
            <p className="rounded-lg border border-t-line p-4 text-t-body"><strong className="text-t-ink">The relay can see</strong> which agent key a sealed envelope is for, and your IP address.</p>
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

        <section id="plugin" aria-label="Connect your AI agent" className="space-y-5">
          <h2 className={label}>Connect your AI agent</h2>
          <p className="max-w-2xl leading-relaxed text-t-body">Your agent uses a small plugin that runs on your own computer, alongside Claude Code, Codex or any other MCP client. This part needs a terminal.</p>
          <ol className="space-y-4">
            {agentSteps.map(([title, text, command], index) => <li key={title} className="space-y-3 rounded-lg border border-t-line p-5">
              <h3 className="flex items-center gap-3 font-semibold text-t-ink"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-t-accent font-mono text-xs text-t-accent">{index + 1}</span>{title}</h3>
              <p className="text-sm leading-relaxed text-t-body">{text}</p>
              <pre className={code}>{command}</pre>
            </li>)}
          </ol>
          <div className="grid gap-4 text-sm leading-relaxed sm:grid-cols-2">
            <p className="rounded-lg border border-t-line p-4 text-t-body"><strong className="text-t-ink">Your agent can</strong> read your inbox, send requests and reply, all inside the limits you set.</p>
            <p className="rounded-lg border border-t-line p-4 text-t-body"><strong className="text-t-ink">Only you can</strong> pair with someone, approve anything over the limits, change the limits and replace keys.</p>
          </div>
          <a className="text-sm text-t-accent underline" href="https://github.com/Cam-Smith-One/v0-termnl-chat-app">Repository (access required)</a>
        </section>

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
