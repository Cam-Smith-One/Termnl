#!/usr/bin/env node
import WebSocket from "ws";
import { useWebSocketImplementation as installWebSocket } from "nostr-tools/pool";
installWebSocket(WebSocket);
import { parseArgs } from "node:util";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
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
  watch [--minutes 15]                                     stay running and notify when a message arrives (no polling; --minutes is the fallback check)
  inbox [--all]                                            list inbound requests
  approve <request-id> [--accept]                          approve a request outside the mandate
  send <contact[,contact...]> <request|offer|inform> <subject> [--details ..] [--amount n] [--currency AUD] [--due date] [--file path ...]
                                                           several contacts each get their own copy; add --show-recipients to let them see each other
  save <request-id>                                        download and decrypt a request's attachments (saved, never opened)
  commitments                                              list signed commitments
  accept|decline|counter <request-id> [note]                 respond (accept needs mandate or prior owner approval)
  outbox                                                   show sent requests and replies
  mandate [JSON]                                           read or replace the owner's mandate
  relays [wss://... ...]                                    read or replace relay list
  handle whois <name> | handle claim <name>                  optional termnl.app handle registry
  rotate [--days 30]                                       issue a new agent key and notify contacts
  log [--last 50]                                          show recent activity
  backup <file>                                           owner-only plaintext-key backup (0600); keep offline
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
    accept: { type: "boolean" },
    details: { type: "string" },
    amount: { type: "string" },
    currency: { type: "string" },
    due: { type: "string" },
    file: { type: "string", multiple: true },
    last: { type: "string" },
    help: { type: "boolean" },
    "confirm-profile-reset": { type: "boolean" },
  },
});
const [cmd, ...args] = positionals;
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

  const mail = new Termnl(new FileStore());
  try {
    switch (cmd) {
      case "whoami":
        return out(mail.whoami());
      case "lock": return out("CLI session closed; the owner-only profile files remain on disk.");
      case "backup": {
        if (!args[0]) throw new Error("backup <new-file.json> — contains plaintext keys; keep offline");
        const names = ["config.json","identity.key","agent.json","mandate.json","contacts.json","inbox.json","outbox.json","commitments.json","invites.json","seen.json"];
        const files = Object.fromEntries(names.filter(name => mail.store.has(name)).map(name => [name,mail.store.read(name,null)]));
        writeFileSync(args[0],JSON.stringify({version:1,files},null,2),{mode:0o600,flag:"wx"});
        return out(`Wrote owner-only backup to ${args[0]}. It contains plaintext keys: store it offline, not in chat or Git.`);
      }
      case "reset": {
        if (!values["confirm-profile-reset"]) throw new Error("This permanently removes the profile. Back up first, then use reset --confirm-profile-reset.");
        mail.close();
        for (const name of ["config.json","identity.key","agent.json","mandate.json","contacts.json","inbox.json","outbox.json","commitments.json","invites.json","seen.json","log.jsonl"]) {
          const path = join(mail.store.dir,name);if(existsSync(path))unlinkSync(path);
        }
        return out("Removed this local profile's known files.");
      }
      case "invite":
        return out(`https://termnl.app/pair#${mail.createInvite(Number(values.minutes ?? 60))}`);
      case "relays": return out(args.length ? mail.setRelays(args) : mail.whoami().relays);
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
        return out(mail.contacts().map((c) => ({ name: c.name, npub: npubEncode(c.identity), relays: c.relays, ...(c.pending && { status: "waiting for them to confirm" }) })));
      case "sync":
        return out(await mail.sync());
      case "watch": {
        const nameOf = (identity: string) => mail.contacts().find((c) => c.identity === identity)?.name ?? "A contact";
        mail.watch((news) => {
          for (const n of describe(news, nameOf)) { console.log(`${new Date().toLocaleTimeString()}  ${n.title}: ${n.body}`); notify(n.title, n.body); }
        }, { fallbackMinutes: Number(values.minutes ?? 15) });
        console.log("Watching for Termnl messages. Press Ctrl+C to stop.");
        return await new Promise<void>(() => undefined);
      }
      case "inbox":
        await mail.sync();
        return out(mail.inbox().filter((i) => values.all || i.status === "open"));
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
        if (many.length > 1) {
          const r = await mail.sendToMany(many, body, { owner: true, showRecipients: values["show-recipients"] });
          return out(`Sent to ${r.sent.length} of ${many.length} (${values["show-recipients"] ? "they can see each other" : "recipients hidden from each other"})${r.failed.map((f) => `\nFailed for ${npubEncode(f.to)}: ${f.error}`).join("")}`);
        }
        const item = await mail.sendRequest(to, body, { owner: true });
        return out(`Sent ${item.id}`);
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
