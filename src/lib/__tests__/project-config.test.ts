import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  inspectProjectConfig,
  migrateProjectConfigFile,
  migrateProjectConfigSource,
} from '../project-config'

const SCAFFOLD = `/**
 * astrale.config.ts — binds the Application to its adapter.
 */
import { cloudflare } from '@astrale-os/adapter-cloudflare'
import { deploy, runtime } from '@astrale-os/sdk/deployment'
// Prefer the managed adapter? Swap it:
//   export default deploy({ application, entrypoint: runtime('./runtime.ts'), adapter: astrale({}) })

import { application } from './application.js'

export default deploy({
  application,
  entrypoint: runtime('./runtime.ts'),
  adapter: cloudflare({
    // Local dev: allocated ports.
    dev: { secrets: '.env.dev' },
    prod: {
      route: 'astrale-domain.example.dev',
      secrets: '.env.prod',
    },
  }),
})
`

const MIGRATED = `/**
 * astrale.config.ts — binds the Application to its adapter.
 */
import { cloudflare } from '@astrale-os/adapter-cloudflare'
import { deploy, runtime } from '@astrale-os/sdk/deployment'
import { defineProject } from '@astrale-os/sdk/project'
// Prefer the managed adapter? Swap it:
//   export default deploy({ application, entrypoint: runtime('./runtime.ts'), adapter: astrale({}) })

import { application } from './application.js'

export default defineProject({
  deployment: deploy({
    application,
    entrypoint: runtime('./runtime.ts'),
    adapter: cloudflare({
      // Local dev: allocated ports.
      dev: { secrets: '.env.dev' },
      prod: {
        route: 'astrale-domain.example.dev',
        secrets: '.env.prod',
      },
    }),
  }),
})
`

describe('astrale.config.ts Project migration', () => {
  test('wraps a bare deploy({ ... }) export, keeps comments and indentation, adds one import', () => {
    const migration = migrateProjectConfigSource(SCAFFOLD)
    expect(migration.status).toBe('migrated')
    if (migration.status !== 'migrated') throw new Error('unreachable')
    expect(migration.source).toBe(MIGRATED)
    // idempotent: the rewritten file is already current
    expect(migrateProjectConfigSource(migration.source)).toEqual({ status: 'current' })
  })

  test('follows an aliased deploy import and the root @astrale-os/sdk facade', () => {
    const migration = migrateProjectConfigSource(
      `import { deploy as ship } from '@astrale-os/sdk'\nimport { application } from './application.js'\nexport default ship({ application, entrypoint: runtime('./runtime.ts'), adapter }) satisfies object\n`,
    )
    expect(migration.status).toBe('migrated')
    if (migration.status !== 'migrated') throw new Error('unreachable')
    expect(migration.source).toBe(
      `import { deploy as ship } from '@astrale-os/sdk'\nimport { defineProject } from '@astrale-os/sdk/project'\nimport { application } from './application.js'\nexport default defineProject({\n  deployment: ship({ application, entrypoint: runtime('./runtime.ts'), adapter }),\n}) satisfies object\n`,
    )
  })

  test('refuses shapes it cannot rewrite mechanically', () => {
    expect(migrateProjectConfigSource(`export const x = 1\n`)).toEqual({
      status: 'unsupported',
      reason: 'astrale.config.ts has no default export',
    })
    expect(migrateProjectConfigSource(`export default { adapter: 'studio-e2e' }\n`)).toEqual({
      status: 'unsupported',
      reason: 'the default export is not a deploy({ ... }) call',
    })
    expect(
      migrateProjectConfigSource(
        `import { deploy } from '@astrale-os/sdk'\nexport default deploy(domain, astrale({ prod: { instance: 'x' } }))\n`,
      ),
    ).toMatchObject({ status: 'unsupported', reason: expect.stringContaining('legacy') })
    expect(
      migrateProjectConfigSource(`import { deploy } from 'elsewhere'\nexport default deploy({})\n`),
    ).toMatchObject({ status: 'unsupported', reason: expect.stringContaining('not the deploy()') })
  })

  test('rewrites the file on disk exactly once', () => {
    const root = mkdtempSync(join(tmpdir(), 'astrale-project-config-'))
    try {
      expect(inspectProjectConfig(root)).toBeNull()
      writeFileSync(join(root, 'astrale.config.ts'), SCAFFOLD)
      expect(inspectProjectConfig(root)?.status).toBe('migrated')
      expect(readFileSync(join(root, 'astrale.config.ts'), 'utf8')).toBe(SCAFFOLD)
      expect(migrateProjectConfigFile(root)?.status).toBe('migrated')
      expect(readFileSync(join(root, 'astrale.config.ts'), 'utf8')).toBe(MIGRATED)
      expect(migrateProjectConfigFile(root)).toEqual({ status: 'current' })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
