/** Synchronous storage boundary shared by the browser, CLI and MCP plugin. */
export interface Store {
  readonly dir: string
  has(name: string): boolean
  read<T>(name: string, fallback: T): T
  write(name: string, value: unknown, secret?: boolean): void
  append(name: string, value: unknown): void
  lines<T>(name: string, last?: number): T[]
  /** Optional: take a named lock shared by every process using this profile. Returns its release, or undefined when another process holds it. */
  exclusive?(name: string): (() => void) | undefined
}
