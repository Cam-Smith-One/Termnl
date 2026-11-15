#!/usr/bin/env node
import "./ws";
import { parseArgs } from "node:util";
import { writeFileSync, unlinkSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { npubEncode } from "nostr-tools/nip19";
import { Termnl } from "../lib/termnl/core";
import { FileStore } from "./store";
import { attach, save } from "./files";
import { describe, notify } from "./notify";
import { DEFAULT_RELAYS } from "../lib/termnl/protocol";
import { handleTemplate, handlePayload, handleDifficulty } from "../lib/termnl/handles";
import { minePow } from "nostr-tools/nip13";
import { finalizeEvent } from "nostr-tools/pure";
import { hexToBytes } from "nostr-tools/utils";

/** Owner console. Everything that grants authority happens here, never through the agent. */
const HELP = `termnl <command>

  init --relay <wss://...> [--relay ...] [--name <name>]   create identity, agent key and mandate
  whoami                                                   show address, relays, key expiry, mandate
  invite [--minutes 60]                                    print a one-time pairing invite
  pair <invite>                                            accept someone's invite
  contacts                                                 list paired contacts
  sync                                                     fetch and process new messages
  status [text] [--until <ISO time>]                       show, set or clear ("status clear") what senders are told with their delivery receipt
  receipts <on|off>                                        whether senders are told their messages arrived and were shown
  teams | team <name> [contact,contact...]                 list teams; create or replace one; no members deletes it
  scheduled | cancel <id>                                  list or cancel messages waiting to be sent later
  watch [--minutes 15]                                     stay running and notify when a message arrives (no polling; --minutes is the fallback check)
  inbox [--all]                                            list inbound requests
  approve <request-id> [--accept]                          approve a request outside the mandate
  send <contact|team[,contact...]> <request|offer|inform> <subject> [--at <ISO time>] [--expires <7d|ISO time>] [--re <id>] [--details ..] [--amount n] [--currency AUD] [--due date] [--file path ...]
                                                           several contacts each get their own copy; add --show-recipients to let them see each other
  save <request-id>                                        download and decrypt a request's attachments (saved, never opened)
  commitments                                              list signed commitments
  accept|decline|counter <request-id> [note]                 respond (accept needs mandate or prior owner approval)
  outbox                                                   show sent requests and replies
  mandate [JSON]                                           read or replace the owner's mandate
  relays [wss://... ...]                                    read the relay list, or replace it and tell your contacts
  relays check | find | heal | auto <on|off>               test your relays; list working ones you could add; replace failing ones; do that automatically
  remove <contact> [--block] | unblock <npub> | blocked    stop hearing from a contact; --block also refuses new pairings with them
  export <contact> <file>                                  write everything exchanged with one contact, and its signed agreements, to a file
  search <text>                                            find messages by subject, details, note or contact name
  retention <days|off>                                     remove answered messages from this device after that many days
  handle whois <name> | handle claim <name>                  optional termnl.app handle registry
  rotate [--days 30]                                       issue a new agent key and notify contacts
  log [--last 50]                                          show recent activity
  backup <file>                                           owner-only plaintext-key backup (0600); keep offline
  link <file> | restore <file>                            use this identity on a second computer: link here, move the file yourself, restore there
  lock                                                    close this CLI session; files remain on disk
  reset --confirm-profile-reset                           delete this local profile's known files

Profile directory: $TERMNL_HOME (default ~/.termnl)`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    relay: { type: "string", multiple: true },
    name: { type: "string" },
    minutes: { type: "string" },
    days: { type: "string" },
    all: { type: "boolean" },
    "show-recipients": { type: "boolean" },
    at: { type: "string" },
    re: { type: "string" },
    until: { type: "string" },
    accept: { type: "boolean" },
    details: { type: "string" },
    amount: { type: "string" },
    currency: { type: "string" },
    due: { type: "string" },
    file: { type: "string", multiple: true },
    last: { type: "string" },
    help: { type: "boolean" },
    "confirm-profile-reset": { type: "boolean" },
    block: { type: "boolean" },
    expires: { type: "string" },
  },
});
const [cmd, ...args] = positionals;
const PROFILE_FILES = ["config.json","identity.key","agent.json","mandate.json","contacts.json","inbox.json","outbox.json","commitments.json","invites.json","seen.json","teams.json","prefs.json","scheduled.json","blocked.json"];
const out = (v: unknown) => console.log(typeof v === "string" ? v : JSON.stringify(v, null, 2));

async function main(): Promise<void> {
  if (!cmd || cmd === "help" || values.help) return out(HELP);

  if (cmd === "init") {
    const mail = Termnl.init(new FileStore(), { relays: values.relay ?? DEFAULT_RELAYS, name: values.name ?? args[0] });
    out(mail.whoami());
    out(`\nBack up ${mail.store.dir}/identity.key somewhere offline, then remove it from this machine.`);
    out("Only owner key rotation and handle claims need the identity key.");
    mail.close();
    return;
  }

  if (cmd === "restore") {
    const store = new FileStore();
    if (store.has("config.json")) throw new Error(`There is already a profile in ${store.dir}. Use an empty TERMNL_HOME, or reset this one first.`);
    const { files } = JSON.parse(readFileSync(args[0] ?? "", "utf8")) as { files: Record<string, unknown> };
    // Scheduled messages stay on the device that queued them, or both would send them.
    for (const name of PROFILE_FILES) if (name !== "scheduled.json" && files[name] != null) store.write(name, files[name], true);
    const linked = new Termnl(store);
    out(`Restored ${linked.whoami().name ?? "the profile"} to ${store.dir}.${linked.prefs().linked ? " It is linked: what you send, answer and pair on one device appears on the other." : ""}\nDelete ${args[0]} now: it holds your keys.`);
    linked.close();
    return;
  }

  const mail = new Termnl(new FileStore());
  try {
    switch (cmd) {
      case "whoami":
        return out(mail.whoami());
      case "lock": return out("CLI session closed; the owner-only profile files remain on disk.");
      case "backup": case "link": {
        if (!args[0]) throw new Error(`${cmd} <new-file.json> — contains plaintext keys; keep offline`);
        if (cmd === "link") mail.setPrefs({ linked: true });
        const names = PROFILE_FILES;
        const files = Object.fromEntries(names.filter(name => mail.store.has(name)).map(name => [name,mail.store.read(name,null)]));
        writeFileSync(args[0],JSON.stringify({version:1,files},null,2),{mode:0o600,flag:"wx"});
        if (cmd === "link") return out(`This profile is now linked. Move ${args[0]} to your other computer yourself (not by chat, email or Git), run "termnl restore ${args[0]}" there, then delete the file on both. It contains plaintext keys.`);
        return out(`Wrote owner-only backup to ${args[0]}. It contains plaintext keys: store it offline, not in chat or Git.`);
      }
      case "reset": {
        if (!values["confirm-profile-reset"]) throw new Error("This permanently removes the profile. Back up first, then use reset --confirm-profile-reset.");
        mail.close();
        for (const name of [...PROFILE_FILES,"log.jsonl"]) {
          const path = join(mail.store.dir,name);if(existsSync(path))unlinkSync(path);
        }
        return out("Removed this local profile's known files.");
      }
      case "invite":
        return out(`https://termnl.app/pair#${mail.createInvite(Number(values.minutes ?? 60))}`);
      case "relays": {
        const show = (list: { url: string; ok: boolean; ms?: number; error?: string }[]) => list.map((p) => `${p.ok ? "ok  " : "FAIL"} ${p.url}${p.ok ? ` (${p.ms} ms)` : ` - ${p.error}`}`).join("\n") || "None found";
        if (!args.length) return out(mail.whoami().relays);
        if (args[0] === "check") return out(show(await mail.checkRelays()));
        if (args[0] === "find") return out(show(await mail.findRelays()));
        if (args[0] === "heal") return out(await mail.healRelays());
        if (args[0] === "auto") {
          if (args[1] === "on" || args[1] === "off") mail.setPrefs({ autoRelays: args[1] === "on" });
          return out(`Automatic relay replacement is ${mail.prefs().autoRelays ? "on: a relay that stops working is replaced, at most once a day, and your contacts are told" : "off"}`);
        }
        return out(await mail.changeRelays(args));
      }
      case "remove": {
        const c = mail.removeContact(args[0] ?? "", { block: values.block });
        return out(`${values.block ? "Blocked" : "Removed"} ${c.name ?? npubEncode(c.identity)}. Their messages are now ignored; they have not been told. Your history with them is kept.`);
      }
      case "unblock": mail.unblock(args[0] ?? ""); return out("Unblocked. Pair again to hear from them.");
      case "blocked": return out(mail.blocked().map((b) => npubEncode(b)));
      case "search": return out(mail.search(args.join(" ")));
      case "export": {
        if (!args[0] || !args[1]) throw new Error("export <contact> <new-file.json>");
        const c = mail.resolveContact(args[0]);
        // Everything held about one contact, with the signed agreements, for a record or a legal request.
        const record = { exported_at: new Date().toISOString(), owner: mail.whoami().identity, contact: { name: c.name, npub: npubEncode(c.identity) }, messages: mail.conversation(args[0]), agreements: mail.commitments().filter((r) => r.with === c.identity) };
        writeFileSync(args[1], JSON.stringify(record, null, 2), { mode: 0o600, flag: "wx" });
        return out(`Wrote ${record.messages.length} messages and ${record.agreements.length} signed agreements with ${c.name ?? "this contact"} to ${args[1]}.`);
      }
      case "retention": {
        if (args[0]) {
          const days = args[0] === "off" ? undefined : Number(args[0]);
          if (days !== undefined && !(days >= 1 && days <= 3650)) throw new Error("retention <days|off>");
          mail.setPrefs({ keepDays: days });
        }
        const k = mail.prefs().keepDays;
        return out(k ? `Answered messages are removed from this device after ${k} days. Signed agreements are kept.` : "Messages are kept until you remove the profile.");
      }
      case "mandate": return out(args.length ? mail.setMandate(JSON.parse(args.join(" "))) : mail.mandate());
      case "outbox": await mail.sync(); return out(mail.outbox());
      case "accept": case "decline": case "counter":
        return out(await mail.respond(args[0] ?? "", cmd, args.slice(1).join(" ") || undefined));
      case "handle": {
        const [action, name] = args;
        if (action === "whois") {
          const response = await fetch(`https://termnl.app/.well-known/nostr.json?name=${encodeURIComponent((name || "").split("@")[0])}`);
          return out(await response.json());
        }
        if (action !== "claim") throw new Error("handle claim <name> | handle whois <name>");
        const payload = handlePayload.parse({ name: (name || "").split("@")[0], relays: mail.whoami().relays });
        const sk = hexToBytes(mail.store.read<{ sk: string }>("identity.key", null as never).sk);
        try {
          const work = minePow({ ...handleTemplate(payload, "https://termnl.app/api/handles"), pubkey: mail.store.read<{ identity: string }>("config.json", null as never).identity }, handleDifficulty(payload.name));
          const response = await fetch("https://termnl.app/api/handles", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, event: finalizeEvent(work, sk) }) });
          if (response.status === 503) throw new Error("Handles are not enabled yet");
          const data = await response.json(); if (!response.ok) throw new Error(data.error || "Claim refused"); return out(data);
        } finally { sk.fill(0) }
      }
      case "pair": {
        const c = await mail.acceptInvite(args[0] ?? "");
        return out(`Pairing started with ${c.name ?? "(unnamed)"} ${npubEncode(c.identity)}. It is confirmed once they next check their inbox; you can send after that.`);
      }
      case "contacts":
        return out(mail.contacts().map((c) => ({ name: c.name, npub: npubEncode(c.identity), safety_code: mail.safetyCode(c.identity), relays: c.relays, ...(c.pending && { status: "waiting for them to confirm" }) })));
      case "sync":
        return out(await mail.sync());
      case "watch": {
        const nameOf = (identity: string) => mail.contacts().find((c) => c.identity === identity)?.name ?? "A contact";
        mail.watch((news) => {
          for (const n of describe(news, nameOf)) { console.log(`${new Date().toLocaleTimeString()}  ${n.title}: ${n.body}`); if (!mail.status()) notify(n.title, n.body); }
        }, { fallbackMinutes: Number(values.minutes ?? 15) });
        console.log("Watching for Termnl messages. Press Ctrl+C to stop.");
        return await new Promise<void>(() => undefined);
      }
      case "inbox":
        await mail.sync();
        await mail.markShown();
        return out(mail.inbox().filter((i) => values.all || i.status === "open"));
      case "status": {
        if (args.length) {
          const text = args.join(" ");
          mail.setPrefs({ status: text === "clear" ? undefined : { text: text.slice(0, 200), until: values.until ? Math.floor(Date.parse(values.until) / 1000) : undefined } });
        }
        return out(mail.status() ?? "No status set");
      }
      case "receipts":
        if (args[0] === "on" || args[0] === "off") mail.setPrefs({ receipts: args[0] === "on" });
        return out(`Receipts are ${mail.prefs().receipts === false ? "off" : "on"}`);
      case "teams":
        return out(mail.teams());
      case "team": {
        if (!args[0]) throw new Error("usage: team <name> [contact,contact...]");
        return out(mail.setTeam(args[0], (args[1] ?? "").split(",").map((t) => t.trim()).filter(Boolean)));
      }
      case "scheduled":
        return out(mail.scheduled());
      case "cancel":
        return out(mail.cancelScheduled(args[0] ?? "") ? "Cancelled" : "No scheduled message with that id");
      case "approve": {
        const item = mail.approve(args[0] ?? "");
        if (values.accept) await mail.respond(item.id, "accept", undefined, { owner: true });
        return out(values.accept ? `Approved and accepted ${item.id}` : `Approved ${item.id}; the agent may now accept it`);
      }
      case "send": {
        const [to, kind, subject] = args;
        if (!to || !kind || !subject) throw new Error("usage: send <contact> <request|offer|inform> <subject>");
        const value = values.amount ? { amount: Number(values.amount), currency: values.currency ?? "AUD" } : undefined;
        const body = { kind: kind as "request" | "offer" | "inform", subject, details: values.details, value, due: values.due, attachments: values.file?.length ? await attach(values.file) : undefined };
        const many = to.split(",").map((t) => t.trim()).filter(Boolean);
        const days = /^(\d+)d$/.exec(values.expires ?? "")?.[1];
        const keepUntil = values.expires ? Math.floor(days ? Date.now() / 1000 + Number(days) * 86400 : Date.parse(values.expires) / 1000) : undefined;
        if (values.expires && (!Number.isFinite(keepUntil) || values.at)) throw new Error("--expires takes a number of days (7d) or an ISO time, and cannot be combined with --at");
        if (values.at) {
          const s = mail.schedule(many, body, Math.floor(Date.parse(values.at) / 1000), { re: values.re, showRecipients: values["show-recipients"] });
          return out(`Scheduled ${s.id} for ${new Date(s.at * 1000).toLocaleString()}. It goes out when Termnl is next running at or after that time.`);
        }
        const r = await mail.sendToMany(many, body, { owner: true, showRecipients: values["show-recipients"], re: values.re, keepUntil });
        const queued = r.sent.filter((o) => o.unsent).length;
        if (r.sent.length === 1 && !r.failed.length) return out(queued ? `Queued ${r.sent[0].id}: no relay was reachable. It is retried at every check for three days.` : `Sent ${r.sent[0].id}`);
        return out(`${queued ? `${queued} queued for retry. ` : ""}Sent to ${r.sent.length - queued} of ${r.sent.length + r.failed.length} (${r.sent[0]?.group?.shown ? "they can see each other" : "recipients hidden from each other"})${r.failed.map((f) => `\nFailed for ${npubEncode(f.to)}: ${f.error}`).join("")}`);
      }
      case "save": {
        const item = [...mail.inbox(), ...mail.outbox()].find((i) => i.id === args[0]);
        if (!item) throw new Error(`No request ${args[0]}`);
        return out(await save(mail.store.dir, item.id, item.body.attachments));
      }
      case "commitments":
        await mail.sync();
        return out(mail.commitments());
      case "rotate":
        return out(await mail.rotateAgentKey(Number(values.days ?? 30)));
      case "log":
        return out(mail.recentLog(Number(values.last ?? 50)));
      default:
        throw new Error(`Unknown command "${cmd}"\n\n${HELP}`);
    }
  } finally {
    await mail.idle();
    mail.close();
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(`termnl: ${(e as Error).message}`);
    process.exit(1);
  },
);
