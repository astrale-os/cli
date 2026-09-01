import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { setHarnessGateway } from './agent/harness/gateway/config'
import { getHarness } from './agent/harness/selection'
import { handleApi } from './api'
import { registerDomain, unregisterDomain } from './domain'

const roots: string[] = []
const domainIds: string[] = []
const originalHarness = process.env.DOMAIN_STUDIO_HARNESS
let restoreLoadout: (() => void) | undefined

afterEach(() => {
  restoreLoadout?.()
  restoreLoadout = undefined
  if (originalHarness === undefined) delete process.env.DOMAIN_STUDIO_HARNESS
  else process.env.DOMAIN_STUDIO_HARNESS = originalHarness
  while (domainIds.length) unregisterDomain(domainIds.pop()!)
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

test('loadout fails closed instead of probing ambient Claude when gateway auth fails', async () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-loadout-gateway-'))
  roots.push(root)
  mkdirSync(join(root, 'schema'))
  writeFileSync(join(root, 'astrale.config.ts'), 'export default {}\n')
  writeFileSync(join(root, 'schema/index.ts'), 'export const Test = {}\n')
  writeFileSync(
    join(root, 'application.ts'),
    `import { defineApplication } from '@astrale-os/sdk/application'
import { Test } from './schema/index.js'
export default defineApplication({ schema: Test, runtime: {} as never })
`,
  )
  const handle = registerDomain(root)!
  domainIds.push(handle.id)

  process.env.DOMAIN_STUDIO_HARNESS = 'claude'
  const harness = getHarness()
  const originalLoadout = harness.loadout
  let probes = 0
  harness.loadout = async () => {
    probes += 1
    throw new Error('ambient Claude must not be probed')
  }
  restoreLoadout = () => {
    harness.loadout = originalLoadout
  }
  setHarnessGateway(root, {
    scope: 'domain',
    config: {
      enabled: true,
      baseUrl: 'https://gateway.example/v1/models/test',
      auth: { mode: 'host' },
    },
  })

  const url = new URL(`http://127.0.0.1/api/domain/${encodeURIComponent(handle.id)}/agent/loadout`)
  const response = await handleApi(new Request(url), url, () => {})
  expect(response?.status).toBe(200)
  const body = await response!.json()
  expect(body).toMatchObject({
    ok: false,
    source: 'acp',
  })
  expect(body.detail).toContain('model gateway auth failed')
  expect(body.detail).toContain('no valid host-supplied token')
  expect(probes).toBe(0)
})
