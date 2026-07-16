import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { statePath, writeJson } from '../../../state/store'
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

test('rejects enabled gateway configurations that cannot authenticate safely', () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-harness-gateway-invalid-'))
  roots.push(root)

  expect(() =>
    setHarnessGateway(root, {
      scope: 'domain',
      config: { enabled: true, baseUrl: '', auth: { mode: 'mint' } },
    }),
  ).toThrow('gateway base URL is required')
  expect(() =>
    setHarnessGateway(root, {
      scope: 'domain',
      config: { enabled: true, baseUrl: 'file:///tmp/gateway', auth: { mode: 'mint' } },
    }),
  ).toThrow('must use http:// or https://')
  expect(() =>
    setHarnessGateway(root, {
      scope: 'domain',
      config: {
        enabled: true,
        baseUrl: 'https://gateway.example',
        auth: { mode: 'token', token: ' ' },
      },
    }),
  ).toThrow('static token is required')
})

test('fails closed for invalid enabled configuration already present on disk', async () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-harness-gateway-legacy-invalid-'))
  roots.push(root)
  writeJson(root, 'harness-gateway.json', {
    enabled: true,
    baseUrl: '',
    auth: { mode: 'mint' },
  })

  expect(await resolveHarnessEnv(root)).toEqual({
    ok: false,
    error: 'gateway base URL is required while enabled',
  })
})
