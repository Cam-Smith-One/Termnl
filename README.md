# Termnl

An MIT-licensed prototype for one person's agent to exchange encrypted, signed
requests with another person's agent over Nostr. People set the authority; agents
can act only inside the owner's mandate through the MCP tools.

**Live:** https://termnl.app · **Browser console:** https://termnl.app/console

The repository remains private during testing, as chosen by the owner. CLI/plugin
installation currently requires repository access. Public source publication is
a separate release step.

No email, account or Termnl server is needed for messaging. The optional
`name@termnl.app` directory stores public handle mappings only.

## Start in the browser

1. Open `/console`. Set a passphrase of at least 10 characters, then type
   `init cam`. This creates a local identity and a short-lived agent key.
2. Type `invite`. Share the resulting `/pair#termnl1:…` link privately. The
   recipient creates/unlocks a profile and runs the pre-filled `pair` command.
   The sender runs `sync` to complete pairing. Invites work once and expire.
3. Type `contacts`, then send a request:

   ```text
   send alex inform "A synthetic test message"
   sync
   inbox
   ```

Use `help` for every command. `approve <id>` authorizes an inbound request outside
the mandate; `accept <id>` signs the terms. The requester verifies the exact terms
and countersigns. Both sides sync to see the countersigned commitment. `decline`
and `counter` do not grant acceptance authority.

Profiles live under `termnl:<name>` in this browser's localStorage. Secret keys
are persisted only as NIP-49 `ncryptsec` ciphertext. Unlock decrypts the agent key
into session memory. Identity keys are decrypted only for rotation and handle
claims. `lock` closes relay connections and discards session references to keys.
JavaScript cannot guarantee that discarded memory is immediately zeroed by the
runtime. Passphrases are never sent to the application server.

**Back up your profile and keep the passphrase separately. There is no recovery
service.** `backup` downloads the profile with encrypted keys. Local message
history and non-secret profile data are stored as plaintext in browser storage
and backups. To restore, lock the console, open **RESTORE ENCRYPTED-KEY BACKUP**,
choose a new local name and your backup JSON, then unlock with the original
passphrase. Clearing browser data without a backup loses your profile.

Commands include `help`, `init`, `unlock`, `whoami`, `relays`, `invite`, `pair`,
`contacts`, `sync`, `inbox`, `approve`, `accept`, `decline`, `counter`, `send`,
`outbox`, `commitments`, `mandate`, `handle claim|whois`, `rotate`, `backup`, `lock`
and `reset`. The browser is the **owner** console. Peer text is labelled untrusted
and rendered as text, never HTML. Sync runs every 30 seconds while unlocked.

## Local CLI and agent plugin

The CLI and MCP plugin are published on npm as [`termnl`](https://www.npmjs.com/package/termnl).
Requires Node 22.18+.

```sh
npx -y termnl init --name my-agent
claude mcp add --scope user termnl -- npx -y -p termnl termnl-mcp   # or: codex mcp add termnl -- npx -y -p termnl termnl-mcp
npx -y termnl invite
```

To build from source instead (also needs pnpm 10.28.2):

```sh
git clone https://github.com/Cam-Smith-One/v0-termnl-chat-app.git termnl && cd termnl
pnpm install --frozen-lockfile && pnpm build:cli
node dist-cli/termnl.mjs init --name cam-agent
node dist-cli/termnl.mjs invite
```

The bins are `termnl` and `termnl-mcp`; `npm link` can make them available on your
PATH after building. By default the CLI stores a profile in `~/.termnl`, or set
`TERMNL_HOME` to a separate directory for each profile. Node secret files use
owner-only permissions. Back up `identity.key` offline and remove it from the
agent machine if rotation/handle claims are not needed there.
`termnl backup <file.json>` creates a new owner-only (0600) file containing
plaintext Node keys; keep it offline. It is not the browser encrypted-key backup
format. `termnl lock` ends the CLI session, and `termnl reset
--confirm-profile-reset` deletes known local profile files.

Configure any stdio MCP client with:

```json
{
  "mcpServers": {
    "termnl": {
      "command": "node",
      "args": ["/absolute/path/to/termnl/dist-cli/mcp.mjs"],
      "env": { "TERMNL_HOME": "/absolute/path/to/your/termnl-profile" }
    }
  }
}
```

Codex can register this server with `codex mcp add termnl -- node
/absolute/path/to/termnl/dist-cli/mcp.mjs`; Claude Code can use `claude mcp add
termnl -- node /absolute/path/to/termnl/dist-cli/mcp.mjs`. Initialize the local
profile before starting the client. Use `TERMNL_HOME` in the client's server
environment for a non-default profile. Restart the plugin after a key rotation
or relay configuration change.

The nine agent tools are `whoami`, `list_contacts`, `check_inbox`, `send_request`,
`respond`, `list_outbox`, `list_commitments`, `get_log`, and `inbox_check_interval`
(how often a session-start hook, if you set one up, checks for waiting requests). **Pairing, owner
approval, mandate editing, key rotation and handle claims are not MCP tools.**
The CLI owner performs those actions out of band. A local agent with unrestricted
filesystem access can edit files directly; this tool boundary is not an operating
system sandbox.

Browser and CLI/plugin profiles are separate identities in this release. They
can pair with each other; they do not share an unlocked browser identity or an
existing IDE session. Linking one identity across browser and local plugin is
future work. No model API, AI Gateway, Codex or Claude login token is stored by
Termnl. The plugin supplies communication tools to your existing agent.

## Authority and messages

- **Authority:** a validated mandate controls outbound kinds/value/currency and
  which inbound requests the agent may accept. Defaults allow zero-value
  information; offers and explicitly declared monetary values require owner action.
- **Messages:** zod-validated envelopes for pairing, requests, responses,
  countersignatures and certificate updates. Commitments bind both identities,
  the exact request ID, request hash and terms.
- **Transport:** identity and short-lived agent keys, NIP-44 encryption, NIP-59
  gift wraps (1059), NIP-42 relay authentication. Only gift wraps are published.

`mandate` displays the current rules. `mandate '<JSON>'` in the CLI or
`mandate <JSON>` in the browser replaces them as an owner action. Changes do not
turn peer text into authority. Agent acceptance re-checks the current mandate
unless the owner explicitly approved that request.

## Relays and availability

The default is **wss://relay.primal.net**. A synthetic probe on 13 November 2026
verified acceptance and read-back of kind 1059 events from fresh keys. The same
probe saw Damus acknowledge a publish without returning it on read-back, and
nos.lol time out. These are observations, not availability guarantees.

Use `relays wss://your-relay.example` to change the list before initialization or
in an unlocked profile. Remote relays must use WSS. WS is allowed only for local
Node/development testing. Changing relay lists does not automatically notify
existing contacts: exchange a new invite so their records know where to deliver.
Use relays you trust. An acknowledgement is not a guarantee of durable delivery.

Vercel serves the web app and handle API. It does not host a Nostr relay. Running
a dedicated Termnl relay requires other long-running infrastructure and is not
part of this release.

## Optional NIP-05 handles

Handles are public aliases for **identity** keys, not agent keys. They do not
replace private pairing invites or grant message authority.

1. Run the owner-reviewed `scripts/01-handles.sql` in your Supabase project.
2. Set server-only `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (see
   `.env.example`). Never put the service key in a `NEXT_PUBLIC_` variable.
3. In the console, re-enter the passphrase and run `handle claim cam`.
4. Resolve with `handle whois cam` or
   `GET /.well-known/nostr.json?name=cam`.

Claims require a fresh kind-27235 identity signature, exact URL/method, a hash
binding the name/relays, and NIP-13 proof of work (18 bits, 22 for names of five characters or fewer). At most ten new handles are accepted per hour. Mining runs in a browser
worker, without a secret key. One handle per public key; existing claims cannot
be replaced by another key. Reserved names are blocked. This modest proof of
work slows bulk claims; it does not eliminate squatting or abuse.

Only the registry uses Supabase. Its table has RLS and no browser-role access.
If it is not configured or the table is missing, APIs return 503 and the console
reports that handles are not enabled yet. Messaging still works. The current
hosted registry uses the existing Free project; Free plan inactivity pausing can
make handle lookup temporarily unavailable.

## Development and checks

```sh
pnpm dev
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

`lib/termnl` is browser/Node-compatible core with a `Store` interface. `cli/`
contains the Node file store and esbuild entry points; `dist-cli/` is generated.
The test suite covers the original nine protocol cases, browser key persistence,
wrong-passphrase/lock/unlock, handle signatures/PoW/payload binding, relay auth and
the MCP authority boundary. Old app history is retained in Git at `3e86046`.

## Known limits

- **Prototype; no security review has been done.**
- No forward secrecy: a stolen agent key can decrypt messages sent to it. MLS via
  the Marmot protocol is planned, not implemented.
- Browser keys are only as safe as the page. XSS could read unlocked keys. No
  third-party scripts are loaded on the console. CSP allows inline Next.js
  scripts/styles and is not a substitute for a security review.
- No remote signing (NIP-46).
- Relays see the recipient agent key and client IP. Relays requiring NIP-42 also
  see the authenticating agent key. Public relays may rate-limit, reject, drop or
  expire events. Delivery and countersignature retries are not durable queues.
- Event kinds 4270–4273 are provisional, not registered Nostr kinds.
- Browser and local plugin profiles are separate for now.
- Local file storage is not a hardened multi-process database. Avoid concurrent
  owner/plugin writes; stop the plugin for owner changes and restart it afterwards.
- Rotation retires the old decryption key; finish pending exchanges before
  rotating. Losing a profile/passphrase can mean losing undelivered messages.
- Mandates validate typed kinds, amounts and currencies. They do not infer
  obligations hidden in free text or verify the truth of peer claims.
- The legal weight of an agent-signed commitment is untested. No payment or
  contract-enforcement integration is implemented.

MIT license. Copyright 2026 Cam Smith.
