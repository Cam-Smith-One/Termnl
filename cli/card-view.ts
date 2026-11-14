import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import { CARD_HTML } from "./card";

/** A read-only, loopback-only card view for clients without MCP Apps support. */
export class CardView {
  private server?: Server;
  private starting?: Promise<void>;
  private readonly token = randomBytes(24).toString("hex");
  private readonly pages = new Map<string, string>();
  private origin = "";

  async publish(section: "messages" | "sent", data: Record<string, unknown>): Promise<string> {
    // Escaping '<' prevents peer text from closing the inert JSON script element.
    const snapshot = JSON.stringify({ content: [{ type: "text", text: JSON.stringify(data) }] }).replace(/</g, "\\u003c");
    const page = CARD_HTML.replace("<body>", '<body data-standalone="true">').replace(
      "<script>",
      () => '<script id="snapshot" type="application/json">' + snapshot + "</script><script>",
    );
    this.pages.set(section, page);
    this.starting ??= this.start();
    await this.starting;
    return `${this.origin}/${this.token}/${section}`;
  }

  private async start(): Promise<void> {
    const server = createServer((req, res) => {
      const headers = {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      };
      const section = req.url?.startsWith(`/${this.token}/`) ? req.url.slice(this.token.length + 2) : "";
      const page = this.pages.get(section);
      // Checking Host prevents DNS rebinding. There are no write or agent-action routes.
      if (req.headers.host !== this.origin.slice(7) || !page || !["GET", "HEAD"].includes(req.method || "")) {
        res.writeHead(404, headers).end();
        return;
      }
      res.writeHead(200, { ...headers, "Content-Type": "text/html; charset=utf-8" });
      res.end(req.method === "HEAD" ? undefined : page);
    });
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.removeListener("error", reject);
        const address = server.address();
        if (!address || typeof address === "string") return reject(new Error("Cannot open local card view"));
        this.origin = `http://127.0.0.1:${address.port}`;
        server.unref();
        resolve();
      });
    });
  }

  async close(): Promise<void> {
    await this.starting;
    if (this.server) await new Promise<void>((resolve, reject) => this.server!.close(error => error ? reject(error) : resolve()));
    this.pages.clear();
  }
}
