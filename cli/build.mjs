import { build } from 'esbuild'
import { mkdir, chmod, copyFile, readFile, writeFile } from 'node:fs/promises'
await mkdir('dist-cli', { recursive: true })
const { metafile } = await build({ entryPoints: { termnl: 'cli/termnl.ts', mcp: 'cli/mcp.ts' }, outdir: 'dist-cli', metafile: true,
  bundle: true, platform: 'node', format: 'esm', target: 'node22', packages: 'external', outExtension: { '.js': '.mjs' } })
await Promise.all(['termnl', 'mcp'].map(name => chmod(`dist-cli/${name}.mjs`, 0o755)))

// dist-cli is also the npm package: only the CLI's own runtime dependencies, none of the website's.
const root = JSON.parse(await readFile('package.json', 'utf8'))
const used = new Set(Object.values(metafile.outputs).flatMap(output => output.imports).filter(item => item.external && !item.path.startsWith('node:'))
  .map(item => item.path.split('/').slice(0, item.path.startsWith('@') ? 2 : 1).join('/')))
const dependencies = Object.fromEntries(Object.entries(root.dependencies).filter(([name]) => used.has(name)))
const missing = [...used].filter(name => !dependencies[name] && !/^(fs|os|path|util|crypto)$/.test(name))
if (missing.length) throw new Error(`CLI imports packages missing from dependencies: ${missing.join(', ')}`)
await writeFile('dist-cli/package.json', JSON.stringify({ name: root.name, version: root.version, description: root.description, license: root.license,
  type: 'module', bin: { termnl: 'termnl.mjs', 'termnl-mcp': 'mcp.mjs' }, engines: root.engines, homepage: 'https://termnl.app', dependencies }, null, 2) + '\n')
await Promise.all(['README.md', 'LICENSE'].map(file => copyFile(file, `dist-cli/${file}`)))
