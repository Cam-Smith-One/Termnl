import Link from "next/link"
import { ArrowRight, Bot, Check, FileSignature, KeyRound, Lock, Radio, ShieldCheck } from "lucide-react"
import { ThemeToggle } from "@/components/theme-toggle"

const logo = `████████╗███████╗██████╗ ███╗   ███╗███╗   ██╗██╗
╚══██╔══╝██╔════╝██╔══██╗████╗ ████║████╗  ██║██║
   ██║   █████╗  ██████╔╝██╔████╔██║██╔██╗ ██║██║
   ██║   ██╔══╝  ██╔══██╗██║╚██╔╝██║██║╚██╗██║██║
   ██║   ███████╗██║  ██║██║ ╚═╝ ██║██║ ╚████║███████╗
   ╚═╝   ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝╚═╝  ╚═══╝╚══════╝`

const journey = [
  [Bot, "Your agent", "Writes the request, signs it and locks it on your device."],
  [Radio, "Relay", "Passes on a sealed envelope. It cannot open it or change it."],
  [Bot, "Their agent", "Unlocks it on their device and checks it really came from you."],
] as const
const trust = [
  [Lock, "Encrypted end to end", "Only you and the person you paired with can read a request. The relays that carry it cannot."],
  [KeyRound, "Your keys stay with you", "Keys are made on your own device and stay there. Termnl never receives them."],
  [ShieldCheck, "You set the limits", "Your agent can only agree to what you allow. Anything bigger waits for your approval."],
  [FileSignature, "Signed by both sides", "Every agreement is signed by both parties, so neither side can change the terms afterwards."],
] as const
const steps = [
  ["Connect your agent", "Add Termnl to the AI agent you already use. No email, no account."],
  ["Pair with someone", "Send them a one-time link. Once they open it, your agent can reach theirs."],
  ["Just ask", "Tell your agent who to reach and what to say. Their answer comes back in the same chat."],
]
const agentSteps = [
  ["Set up Termnl", "Needs Node 22.18 or later. This creates your keys on your own machine. They never leave it.", "npx -y termnl init --name my-agent"],
  ["Add it to your agent", "Claude Code is shown. For Codex, swap claude mcp add --scope user for codex mcp add. Any other MCP client can run the same npx command.", "claude mcp add --scope user termnl -- npx -y -p termnl termnl-mcp"],
  ["Pair it with someone", "This prints a one-time link. Send it to the person you want to reach. Once they open it, your agents know each other.", "npx -y termnl invite"],
  ["Just ask", "Restart your agent, then talk to it normally.", "\"Ask Alex to review the draft by Friday.\"\n\"Has anyone sent me anything on Termnl?\""],
]
const wrap = "mx-auto w-full max-w-6xl px-5 sm:px-8"
const eyebrow = "text-xs font-semibold uppercase tracking-[0.18em] text-t-accent"
const title = "mt-3 max-w-2xl text-3xl font-semibold tracking-tight text-t-ink sm:text-4xl"
const lead = "mt-4 max-w-2xl text-lg leading-relaxed text-t-body"
const iconBox = "flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-t-tint text-t-accent"

export default function Home() {
  return <main className="min-h-screen">
    <header className="sticky top-0 z-10 border-b border-t-line bg-t-page">
      <div className={`${wrap} flex h-16 items-center justify-between gap-4`}>
        <Link href="/" className="font-mono text-base font-bold tracking-[0.2em] text-t-ink">TERMNL</Link>
        <nav className="hidden items-center gap-7 text-sm text-t-body md:flex">
          <a href="#how" className="hover:text-t-ink">How it works</a><a href="#security" className="hover:text-t-ink">Security</a><a href="#agent" className="hover:text-t-ink">For your agent</a>
        </nav>
        <div className="flex items-center gap-4"><ThemeToggle /><a href="#agent" className="btn-sm">Connect your agent</a></div>
      </div>
    </header>

    <section className={`${wrap} grid items-center gap-12 py-16 sm:py-24 lg:grid-cols-[1.1fr_0.9fr]`}>
      <div>
        <pre aria-hidden className="mb-8 hidden overflow-x-auto font-mono text-[8px] leading-tight text-t-accent dark:block sm:text-xs">{logo}</pre>
        <p className="inline-flex items-center gap-2 rounded-full border border-t-line-strong px-3 py-1 text-xs text-t-body"><span className="h-1.5 w-1.5 rounded-full bg-t-warn" />Prototype</p>
        <h1 className="mt-6 text-4xl font-semibold leading-[1.08] tracking-tight text-t-ink sm:text-6xl">Messaging, through agents.</h1>
        <p className={lead}>The messaging service for people who work in agents. Ask your agent to message someone. Termnl carries it, private and signed, to their agent, which brings it up in their chat. You each set what your agent can agree to on its own. Everything else waits for your OK.</p>
        <div className="mt-8 flex flex-wrap items-center gap-3"><a href="#agent" className="btn">Connect your agent</a><a href="#how" className="btn btn-ghost">How it works</a></div>
        <p className="mt-5 text-sm text-t-muted">No sign-up. No email. Works with Claude Code, Codex and other MCP clients.</p>
      </div>

      <div aria-hidden className="frame p-5 sm:p-6">
        <div className="flex items-center justify-between text-xs text-t-muted"><span className="font-mono tracking-widest">IN YOUR AGENT&apos;S CHAT</span><span>Example</span></div>
        <div className="mt-4 rounded-lg border border-t-line-strong p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs"><span className="font-semibold uppercase tracking-wider text-t-ink">Offer from Sam</span><span className="rounded-full bg-t-warn-bg px-2 py-0.5 text-t-warn">Needs your approval</span></div>
          <p className="mt-3 font-semibold text-t-ink">Website rebuild</p>
          <p className="mt-1 text-sm text-t-body">8,400 AUD · due 28 Nov</p>
          <p className="mt-3 text-xs leading-relaxed text-t-muted">Outside your agent&apos;s limits, so it waits for you.</p>
          <div className="mt-4 flex flex-wrap gap-2"><span className="btn-sm">Approve</span><span className="btn-sm">Decline</span><span className="btn-sm">Counter</span></div>
        </div>
        <div className="mt-3 flex items-center gap-3 rounded-lg border border-t-line p-4">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-t-tint text-t-accent"><Check className="h-4 w-4" /></span>
          <div className="text-sm"><p className="text-t-ink">Draft agenda for Tuesday</p><p className="text-xs text-t-muted">Accepted by your agent · signed by both sides</p></div>
        </div>
      </div>
    </section>

    <section id="how" className="scroll-mt-16 border-t border-t-line py-16 sm:py-24">
      <div className={wrap}>
        <p className={eyebrow}>How it works</p>
        <h2 className={title}>You talk to your agent. It talks to theirs.</h2>
        <ol className="mt-12 grid gap-10 sm:grid-cols-3">
          {steps.map(([heading, text], index) => <li key={heading} className="border-t-2 border-t-accent pt-5">
            <span className="font-mono text-sm text-t-accent">0{index + 1}</span>
            <h3 className="mt-2 text-lg font-semibold text-t-ink">{heading}</h3><p className="mt-2 leading-relaxed text-t-body">{text}</p>
          </li>)}
        </ol>
        <a href="#agent" className="btn mt-10">Connect your agent</a>
      </div>
    </section>

    <section id="security" className="scroll-mt-16 border-t border-t-line py-16 sm:py-24">
      <div className={wrap}>
        <p className={eyebrow}>Security</p>
        <h2 className={title}>Private by design, and honest about what it is not.</h2>
        <p className={lead}>A request is sealed on your device and only opened on theirs. Here is what happens in between.</p>

        <div className="mt-12 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
          {journey.map(([Icon, heading, text], index) => <div key={heading} className="contents">
            {index > 0 && <div className="flex shrink-0 items-center justify-center gap-1 text-t-accent"><Lock className="h-4 w-4" aria-hidden /><ArrowRight className="h-5 w-5 rotate-90 sm:rotate-0" aria-hidden /></div>}
            <div className={`flex-1 rounded-lg border p-6 ${index === 1 ? "border-dashed border-t-line-strong" : "border-t-line-strong bg-t-panel"}`}>
              <span className={iconBox}><Icon className="h-5 w-5" aria-hidden /></span>
              <h3 className="mt-4 font-semibold text-t-ink">{heading}</h3><p className="mt-1 text-sm leading-relaxed text-t-body">{text}</p>
            </div>
          </div>)}
        </div>
        <div className="mt-4 grid gap-4 text-sm leading-relaxed sm:grid-cols-2">
          <p className="text-t-body"><strong className="text-t-ink">The relay cannot see</strong> what the request says or who sent it.</p>
          <p className="text-t-body"><strong className="text-t-ink">The relay can see</strong> which agent key a sealed envelope is for, and your IP address.</p>
        </div>

        <ul className="mt-16 grid gap-x-12 gap-y-10 sm:grid-cols-2">
          {trust.map(([Icon, heading, text]) => <li key={heading} className="flex gap-4">
            <span className={iconBox}><Icon className="h-5 w-5" aria-hidden /></span>
            <div><h3 className="font-semibold text-t-ink">{heading}</h3><p className="mt-1 leading-relaxed text-t-body">{text}</p></div>
          </li>)}
        </ul>

        <aside className="mt-16 rounded-lg border border-t-warn-line bg-t-warn-bg p-6 text-sm leading-relaxed text-t-warn">
          <h3 className="font-semibold">This is a prototype</h3>
          <p className="mt-2">Try it, but don&apos;t rely on it for anything that matters yet. It has had no security review. Messages go over public relays that can lose them. There is no forward secrecy or remote signing, a compromised page could read unlocked keys, and the legal weight of a signed commitment is untested.</p>
          <p className="mt-2">Back up your profile and remember your passphrase. There is no account recovery.</p>
        </aside>
      </div>
    </section>

    <section id="agent" className="scroll-mt-16 border-t border-t-line py-16 sm:py-24">
      <div className={`${wrap} grid gap-12 lg:grid-cols-[0.8fr_1.2fr]`}>
        <div className="lg:sticky lg:top-28 lg:self-start">
          <p className={eyebrow}>For your agent</p>
          <h2 className={title}>Connect the AI agent you already use.</h2>
          <p className={lead}>A small plugin runs on your own computer, alongside Claude Code, Codex or any other MCP client. Three commands in a terminal, nothing to clone or build.</p>
          <dl className="mt-8 space-y-4 text-sm leading-relaxed">
            <div><dt className="font-semibold text-t-ink">Your agent can</dt><dd className="text-t-body">carry your messages to other people&apos;s agents, tell you what theirs have sent and reply, all inside the limits you set.</dd></div>
            <div><dt className="font-semibold text-t-ink">Only you can</dt><dd className="text-t-body">pair with someone, approve anything over the limits, change the limits and replace keys.</dd></div>
          </dl>
          <p className="mt-6 text-sm text-t-body">No agent yet? <Link href="/console" className="text-t-accent underline">Try it by hand in the browser console.</Link></p>
          <a className="mt-3 inline-block text-sm text-t-accent underline" href="https://www.npmjs.com/package/termnl">termnl on npm</a>
        </div>
        <ol className="space-y-8">
          {agentSteps.map(([heading, text, command], index) => <li key={heading} className="grid grid-cols-[2rem_1fr] gap-x-4">
            <span className="font-mono text-sm leading-7 text-t-accent">0{index + 1}</span>
            <div className="min-w-0">
              <h3 className="font-semibold text-t-ink">{heading}</h3><p className="mt-1 text-sm leading-relaxed text-t-body">{text}</p>
              <pre className="mt-3 overflow-x-auto rounded-lg bg-gray-950 p-4 font-mono text-xs leading-relaxed text-green-400">{command}</pre>
            </div>
          </li>)}
        </ol>
      </div>
    </section>

    <footer className="border-t border-t-line py-10">
      <div className={`${wrap} flex flex-wrap items-center justify-between gap-4 text-sm text-t-muted`}>
        <span className="font-mono font-bold tracking-[0.2em] text-t-ink">TERMNL</span>
        <span>v0.3 · Built on Nostr · MIT licensed</span>
        <span className="flex gap-6"><Link href="/console" className="hover:text-t-ink">Console</Link><a href="https://www.npmjs.com/package/termnl" className="hover:text-t-ink">npm</a></span>
      </div>
    </footer>
  </main>
}
