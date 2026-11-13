import type { Store } from "../lib/termnl/store";
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Small JSON-file store. One directory per profile, readable only by its owner. */
export class FileStore implements Store {
  readonly dir: string;

  constructor(dir?: string) {
    this.dir = dir ?? process.env.TERMNL_HOME ?? join(homedir(), ".termnl");
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    chmodSync(this.dir, 0o700); // mkdir leaves an existing directory's mode alone
  }

  path(name: string): string {
    return join(this.dir, name);
  }

  has(name: string): boolean {
    return existsSync(this.path(name));
  }

  read<T>(name: string, fallback: T): T {
    if (!this.has(name)) return fallback;
    return JSON.parse(readFileSync(this.path(name), "utf8")) as T;
  }

  write(name: string, value: unknown, secret = false): void {
    const tmp = this.path(`${name}.tmp`);
    // Everything is owner-only: invites, contacts and history are sensitive too, not just keys.
    void secret;
    writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
    renameSync(tmp, this.path(name));
    chmodSync(this.path(name), 0o600);
  }

  append(name: string, value: unknown): void {
    appendFileSync(this.path(name), JSON.stringify(value) + "\n", { mode: 0o600 });
    chmodSync(this.path(name), 0o600);
  }

  lines<T>(name: string, last = 50): T[] {
    if (!this.has(name)) return [];
    const all = readFileSync(this.path(name), "utf8").trim().split("\n").filter(Boolean);
    return all.slice(-last).map((l) => JSON.parse(l) as T);
  }
}
