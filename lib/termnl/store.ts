/** Synchronous storage boundary shared by the browser, CLI and MCP plugin. */
export interface Store {
  readonly dir: string
  has(name: string): boolean
  read<T>(name: string, fallback: T): T
  write(name: string, value: unknown, secret?: boolean): void
  append(name: string, value: unknown): void
  lines<T>(name: string, last?: number): T[]
}
