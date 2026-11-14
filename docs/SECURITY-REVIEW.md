# Security review

**Date:** 14 November 2026 · **Scope:** the whole repository at the commit before this file was added ·
**Kind:** internal, AI-assisted code review. **This is not an independent audit or a penetration test.**

## How it was done

The code was split into three areas, each read in full by a separate reviewer:

1. Protocol and core logic: pairing, certificates and rotation, message handling, mandate enforcement,
   commitments, receipts, scheduling, teams, attachments and key storage.
2. Server and browser: the relay, the handle registry, API routes, headers and CSP, the browser console
   and the pairing page.
3. Local programs: the command line, the MCP plugin and its tools, desktop notifications, the message
   card, the local card view and the Claude Code panel.

Every finding was then checked by a second, independent reviewer told to be sceptical. Only issues with a
concrete attack path were kept. Denial of service, rate limiting and missing hardening without an attack
were out of scope, as was anything requiring a local user who already has the owner's file access.

## Result

No high-severity issue was found. Reviewers found no way for an unpaired or wrong party to get a message
accepted, to forge or alter a signed agreement, to read another person's messages on the relay, to take
over a handle, to inject script into the card, console or pairing page, to run commands through
notification text, or to write a received file outside the downloads folder.

Five issues were confirmed and fixed in the same change that added this file. Each has a test.

| # | Issue | Severity | Fix |
| - | ----- | -------- | --- |
| 1 | With `agentMaySendFiles` on, the agent could be asked to attach any local file, including the profile's private keys, and send it to a contact. | Medium, only when the owner enabled file sending | The agent can attach only regular files inside folders the owner chose (`agentFileDirs`, or the profile's `share` folder). Links are resolved first, and the profile's own files are always refused. |
| 2 | Accepting an invite that reused a confirmed contact's certificate overwrote that contact's relays and name, so a third party could silently redirect messages (still encrypted) away from them. | Low to medium, needs the owner to accept a crafted invite | Nothing in an invite is believed for a confirmed contact. A contact's relays now change only on a message signed by that contact's own agent key. |
| 3 | Attachment downloads followed redirects, so a sender's file server could bounce the request to a local or internal address. Blind: no response reached the sender. | Low to medium | Redirects are refused for uploads and downloads. |
| 4 | Relay addresses supplied by another party were accepted for local, internal and literal-IP hosts, allowing blind connection attempts to the owner's machine or network. | Low | Peer-supplied relays must be public `wss://` hosts. |
| 5 | The mandate's amount cap applied only when the sender declared an amount, so a request or offer that left it out was marked as acceptable by the agent. This was a documented limit, not a bypass of a stated guarantee. | Design tightening | A request or offer with no declared amount now waits for the owner. Information messages are unchanged. |

## What this review does not cover

- It was done by AI reviewers reading code, with targeted local tests. Nobody attacked the running service.
- Dependencies (including `nostr-tools` and the cryptography it uses) were treated as correct.
- A hostname that resolves to a private address is not detected (items 3 and 4 block literal addresses and redirects).
- Prompt injection is limited by what the tools allow, not prevented: an agent can still be persuaded to do
  anything its mandate permits, including acknowledging a message whose free text describes an obligation.
- The limits listed in the README still apply: no forward secrecy, no remote signing, browser keys are only
  as safe as the page, and the legal weight of a signed commitment is untested.

An independent audit is still recommended before relying on Termnl for anything that matters.
