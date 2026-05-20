import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const testDir = dirname(fileURLToPath(import.meta.url))
// testDir = workspace/domains/<slug>/test → ../../.. = workspace.
// If the domains/ folder is ever moved, update the depth here in lockstep.
const ws = resolve(testDir, '../../..')

// Kernel packages live in the workspace as source TS — vite needs aliases
// to resolve them since they're not published npm packages.
const k = (pkg: string) => resolve(ws, 'kernel', pkg)
const alias = (name: string, path: string) => ({ find: name, replacement: path })

export default defineConfig({
  resolve: {
    alias: [
      // zod — bypass the `@zod/source` export condition (resolves to src/index.ts
      // which imports `./v4/classic/external.js`, a file that only exists as
      // `.ts` on disk; vite's default resolver bails). Point at the built
      // entry in `node_modules/zod/index.js`.
      alias('zod', resolve(ws, 'kernel/domains/node_modules/zod/index.js')),
      // Kernel packages — specific sub-path exports (specific FIRST, regex catch-all SECOND).
      // Every entry in kernel/core/package.json `exports` has an explicit alias here.
      alias('@astrale-os/kernel-core/expression', k('core/auth/expression/index.ts')),
      alias('@astrale-os/kernel-core/credentials', k('core/auth/credentials/index.ts')),
      alias('@astrale-os/kernel-core/path', k('core/graph/nav/path/index.ts')),
      alias('@astrale-os/kernel-core/tree', k('core/graph/tree/index.ts')),
      alias('@astrale-os/kernel-core/sync', k('core/graph/sync/index.ts')),
      alias('@astrale-os/kernel-core/graph', k('core/graph/index.ts')),
      alias('@astrale-os/kernel-core/domain', k('core/domain/index.ts')),
      alias('@astrale-os/kernel-core/domain-path', k('core/domain/addressing/paths/index.ts')),
      alias('@astrale-os/kernel-core/schema', k('core/schema/index.ts')),
      alias('@astrale-os/kernel-server/serve/node', k('server/serve/node.ts')),
      alias('@astrale-os/kernel-server/serve/bun', k('server/serve/bun.ts')),
      alias('@astrale-os/kernel-server/serve', k('server/serve/index.ts')),
      alias('@astrale-os/kernel-server/app', k('server/app/index.ts')),
      // Kernel packages — regex aliases to catch sub-path exports
      { find: /^@astrale-os\/kernel-core\/(.+)$/, replacement: k('core/$1/index.ts') },
      { find: /^@astrale-os\/kernel-api\/(.+)$/, replacement: k('api/$1/index.ts') },
      { find: /^@astrale-os\/kernel-server\/(.+)$/, replacement: k('server/$1/index.ts') },
      { find: /^@astrale-os\/kernel-runtime\/(.+)$/, replacement: k('runtime/$1/index.ts') },
      { find: /^@astrale-os\/kernel-ports\/(.+)$/, replacement: k('ports/$1/index.ts') },
      // Kernel packages — root exports
      alias('@astrale-os/kernel-core', k('core/index.ts')),
      alias('@astrale-os/kernel-api', k('api/index.ts')),
      alias('@astrale-os/kernel-server', k('server/index.ts')),
      // kernel-client sub-path alias must precede the bare alias — vite
      // doesn't fall back from `@astrale-os/kernel-client/session` to a
      // sub-resolution when the bare alias points at a file path.
      alias('@astrale-os/kernel-client/session', k('client/src/session/index.ts')),
      alias('@astrale-os/kernel-client', k('client/src/index.ts')),
      alias('@astrale-os/kernel-test', k('test/src/index.ts')),
      alias('@astrale-os/kernel-host', k('host/src/index.ts')),
      alias('@astrale-os/kernel-runtime', k('runtime/index.ts')),
      alias('@astrale-os/kernel-ports', k('ports/index.ts')),
      // SDK + DSL (source TS)
      { find: /^@astrale-os\/sdk\/(.+)$/, replacement: resolve(ws, 'sdk/src/$1/index.ts') },
      alias('@astrale-os/sdk', resolve(ws, 'sdk/src/index.ts')),
      alias('@astrale-os/kernel-dsl', k('dsl/src/index.ts')),
      alias('@astrale-os/kernel-adapters/falkordb', k('adapters/graph/falkordb/index.ts')),
      alias('@astrale-os/kernel-adapters', k('adapters/index.ts')),
      // Node packages from pnpm store
      alias('@hono/node-server', resolve(ws, 'node_modules/.pnpm/node_modules/@hono/node-server')),
    ],
  },
  test: {
    root: testDir,
    include: ['**/*.test.ts'],
    setupFiles: [resolve(testDir, 'setup-env.ts')],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
})
