import { execFile } from "node:child_process";
import type { InboxItem, OutboxItem } from "../lib/termnl/core";

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text).replace(/[\p{Cc}]/gu, " ");

/** One line per arrival, for a terminal and for the desktop notification. Names and subjects are the other party's words. */
export function describe(news: { messages: InboxItem[]; replies: OutboxItem[] }, nameOf: (identity: string) => string): { title: string; body: string }[] {
  return [
    ...news.messages.map((m) => ({ title: `Termnl · ${clip(nameOf(m.from), 60)}`, body: clip(m.body.subject, 140) })),
    ...news.replies.map((o) => ({ title: `Termnl · ${clip(nameOf(o.to), 60)} ${o.status === "committed" ? "agreed" : o.status === "countered" ? "suggested a change" : o.status}`, body: clip(o.body.subject, 140) })),
  ];
}

/** Best-effort desktop notification. Text is passed as arguments, never through a shell or as script source. */
export function notify(title: string, body: string): void {
  if (process.env.TERMNL_NOTIFY === "0") return;
  const done = () => undefined;
  if (process.platform === "darwin") {
    execFile("osascript", ["-e", "on run argv", "-e", "display notification (item 2 of argv) with title (item 1 of argv)", "-e", "end run", title, body], done);
  } else if (process.platform === "linux") {
    execFile("notify-send", ["--", title, body], done);
  }
}
