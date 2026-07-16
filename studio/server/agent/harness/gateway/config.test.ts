import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { statePath } from '../../../state/store'
import {
  clearHarnessGateway,
  getHarnessGatewayState,
  resolveHarnessEnv,
  setHarnessGateway,
} from './config'

const roots: string[] = []

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

test('owns normalized per-domain gateway configuration and child environment', async () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-harness-gateway-'))
  roots.push(root)

  const state = setHarnessGateway(root, {
    scope: 'domain',
    config: {
      enabled: true,
      baseUrl: ' https://gateway.example/v1/models/demo ',
      model: ' demo-model ',
      auth: { mode: 'token', token: ' secret ' },
    },
  })
  expect(state).toMatchObject({
    source: 'domain',
    effective: {
      enabled: true,
      baseUrl: 'https://gateway.example/v1/models/demo',
      model: 'demo-model',
      auth: { mode: 'token', token: 'secret' },
    },
  })
  expect(await resolveHarnessEnv(root)).toEqual({
    ok: true,
    env: {
      ANTHROPIC_BASE_URL: 'https://gateway.example/v1/models/demo',
      ANTHROPIC_AUTH_TOKEN: 'secret',
      ANTHROPIC_MODEL: 'demo-model',
      ANTHROPIC_SMALL_FAST_MODEL: 'demo-model',
    },
  })
  expect(statSync(statePath(root, 'harness-gateway.json')).mode & 0o777).toBe(0o600)

  clearHarnessGateway(root, 'domain')
  expect(getHarnessGatewayState(root).local).toBeNull()
})
