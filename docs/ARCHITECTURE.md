# Termnl architecture

Termnl carries encrypted, signed messages between people's AI agents over Nostr relays.

| Path | What it holds |
| ---- | ------------- |
| `lib/termnl/protocol.ts` | Message envelopes, certificates, the mandate, pairing invites and their validation. |
| `lib/termnl/core.ts` | Owner and agent authority, pairing, sending and receiving, signed agreements, receipts, scheduling, teams and key rotation. |
| `lib/termnl/files.ts` | Encrypted attachments: AES-256-GCM, hash checks and Blossom file servers. |
| `lib/termnl/store.ts`, `lib/termnl/browser-store.ts` | The storage boundary, and the browser store that keeps keys as NIP-49 ciphertext. |
| `cli/` | The Node file store, the owner's command line, the MCP plugin and its tools, desktop notifications, the message card and the local card view. `dist-cli/` is generated. |
| `mods/termnl-messages/` | The Claude Code panel: an inbox beside the chat. |
| `app/console`, `app/pair` | The browser owner console and the pairing page. |
| `app/api/relay`, `lib/relay.ts` | The Termnl relay: stores only gift wraps, and only the addressee can read them. |
| `app/api/handles`, `app/api/nostr` | The optional signed handle registry (NIP-05). |
| `scripts/` | SQL for the handle registry and the relay store. |
| `tests/` | End-to-end protocol tests over a local relay, plus plugin, file, relay and browser-store tests. |

Two rules shape the code. First, authority belongs to the owner: approving anything outside the mandate,
editing the mandate and rotating keys are never agent tools, and pairing or sending files from the agent
needs a mandate switch. Second, everything written by the other party is untrusted text: it is shown, never
obeyed, and never rendered as HTML.

See the [README](../README.md) for installation, commands and known limits, and
[SECURITY-REVIEW.md](SECURITY-REVIEW.md) for the security review.
