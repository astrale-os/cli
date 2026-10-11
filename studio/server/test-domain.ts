/**
 * Test support: a registered on-disk Domain that is the whole workspace, with Studio's
 * machine home beneath it. `disposeTestDomains` (in `afterEach`) unregisters and removes
 * every one, and puts back the environment the tests change.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type DomainHandle, registerDomain, unregisterDomain } from './domain/registry'
import { initWorkspaceRoot } from './workspace/root'

const ENVIRONMENT = [
  'ASTRALE_HOME',
  'DOMAIN_STUDIO_HARNESS',
  'DOMAIN_STUDIO_MOCK_MODE',
  'DOMAIN_STUDIO_MOCK_DELAY_MS',
  'DOMAIN_STUDIO_MOCK_EXPECT_MODEL',
  'DOMAIN_STUDIO_MOCK_EXPECT_SESSION',
] as const
const environment = Object.fromEntries(ENVIRONMENT.map((name) => [name, process.env[name]]))
const domains: DomainHandle[] = []

export function testDomain(): DomainHandle {
  const root = mkdtempSync(join(tmpdir(), 'studio-domain-'))
  mkdirSync(join(root, 'schema'))
  writeFileSync(
    join(root, 'astrale.config.ts'),
    `import { defineProject } from '@astrale-os/sdk/project'
import domain from './domain.js'
export default defineProject({ domain })
`,
  )
  writeFileSync(join(root, 'schema/index.ts'), 'export const Test = {}\n')
  writeFileSync(
    join(root, 'domain.ts'),
    `import { defineDomain } from '@astrale-os/sdk/domain'
import { Test } from './schema/index.js'
export default defineDomain({ schema: Test, runtime: {} as never })
`,
  )
  const handle = registerDomain(root)!
  domains.push(handle)
  process.env.ASTRALE_HOME = join(root, '.astrale')
  initWorkspaceRoot(root)
  return handle
}

export function disposeTestDomains(): void {
  for (const name of ENVIRONMENT) {
    if (environment[name] === undefined) delete process.env[name]
    else process.env[name] = environment[name]
  }
  for (const handle of domains.splice(0)) {
    unregisterDomain(handle.id)
    rmSync(handle.root, { recursive: true, force: true })
  }
}
