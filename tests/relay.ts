import { WebSocketServer, type WebSocket } from "ws";
import { verifyEvent } from "nostr-tools/pure";

interface Ev {
  id: string;
  kind: number;
  created_at: number;
  tags: string[][];
}
type Filter = { ids?: string[]; kinds?: number[]; since?: number; "#p"?: string[] };

function matches(ev: Ev, f: Filter): boolean {
  if (f.ids && !f.ids.includes(ev.id)) return false;
  if (f.kinds && !f.kinds.includes(ev.kind)) return false;
  if (f.since && ev.created_at < f.since) return false;
  if (f["#p"] && !ev.tags.some((t) => t[0] === "p" && f["#p"]!.includes(t[1]))) return false;
  return true;
}

/** Minimal in-memory Nostr relay for tests: EVENT, REQ, CLOSE. No signature checks. */
export function startRelay(port: number, requireAuth = false): { url: string; events: Ev[]; authenticated: string[]; stop: () => Promise<void> } {
  const events: Ev[] = [];
  const subs = new Map<WebSocket, Map<string, Filter[]>>();
  const wss = new WebSocketServer({ port });
  const authenticated: string[] = [];

  wss.on("connection", (ws) => {
    let authed = false;
    const challenge = crypto.randomUUID();
    if (requireAuth) ws.send(JSON.stringify(["AUTH",challenge]));
    subs.set(ws, new Map());
    ws.on("close", () => subs.delete(ws));
    ws.on("message", (raw) => {
      const msg = JSON.parse(String(raw));
      if (msg[0] === "AUTH") {
        const event = msg[1];
        authed = event.kind === 22242 && verifyEvent(event) && event.tags.some((tag:string[]) => tag[0] === "challenge" && tag[1] === challenge);
        if (authed) authenticated.push(event.pubkey);
        ws.send(JSON.stringify(["OK",event.id,authed,authed ? "" : "invalid auth"]));
        return;
      }
      if (requireAuth && !authed) {
        if (msg[0] === "EVENT") ws.send(JSON.stringify(["OK",msg[1].id,false,"auth-required: authenticate first"]));
        if (msg[0] === "REQ") ws.send(JSON.stringify(["CLOSED",msg[1],"auth-required: authenticate first"]));
        return;
      }
      if (msg[0] === "EVENT") {
        const ev = msg[1] as Ev;
        if (!events.some((e) => e.id === ev.id)) events.push(ev);
        ws.send(JSON.stringify(["OK", ev.id, true, ""]));
        for (const [sock, map] of subs) {
          for (const [subId, filters] of map) {
            if (filters.some((f) => matches(ev, f))) sock.send(JSON.stringify(["EVENT", subId, ev]));
          }
        }
      } else if (msg[0] === "REQ") {
        const [, subId, ...filters] = msg as [string, string, ...Filter[]];
        subs.get(ws)?.set(subId, filters);
        for (const ev of events) {
          if (filters.some((f) => matches(ev, f))) ws.send(JSON.stringify(["EVENT", subId, ev]));
        }
        ws.send(JSON.stringify(["EOSE", subId]));
      } else if (msg[0] === "CLOSE") {
        subs.get(ws)?.delete(msg[1]);
      }
    });
  });

  return {
    url: `ws://127.0.0.1:${port}`,
    events,
    authenticated,
    stop: () =>
      new Promise((resolve) => {
        for (const ws of wss.clients) ws.terminate();
        wss.close(() => resolve());
      }),
  };
}
