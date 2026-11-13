import type { Store } from "../lib/termnl/store";
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Small JSON-file store. One directory per profile; secrets are written 0600. */
export class FileStore implements Store {
  readonly dir: string;

  constructor(dir?: string) {
    this.dir = dir ?? process.env.TERMNL_HOME ?? join(homedir(), ".termnl");
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
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
    writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: secret ? 0o600 : 0o644 });
    renameSync(tmp, this.path(name));
    if (secret) chmodSync(this.path(name), 0o600);
  }

  append(name: string, value: unknown): void {
    appendFileSync(this.path(name), JSON.stringify(value) + "\n");
  }

  lines<T>(name: string, last = 50): T[] {
    if (!this.has(name)) return [];
    const all = readFileSync(this.path(name), "utf8").trim().split("\n").filter(Boolean);
    return all.slice(-last).map((l) => JSON.parse(l) as T);
  }
}
