import { build } from 'esbuild'
import { mkdir, chmod } from 'node:fs/promises'
await mkdir('dist-cli', { recursive: true })
await build({ entryPoints: { termnl: 'cli/termnl.ts', mcp: 'cli/mcp.ts' }, outdir: 'dist-cli',
  bundle: true, platform: 'node', format: 'esm', target: 'node22', packages: 'external', outExtension: { '.js': '.mjs' } })
await Promise.all(['termnl', 'mcp'].map(name => chmod(`dist-cli/${name}.mjs`, 0o755)))
