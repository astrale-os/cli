import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { studioHome } from '../../../home'
import { statePath, writeJson } from '../../../state/store'
import {
  clearHarnessGateway,
  getHarnessGatewayState,
  resolveHarnessEnv,
  setHarnessGateway,
} from './config'

const roots: string[] = []
const previousHome = process.env.ASTRALE_HOME

afterEach(() => {
  if (previousHome === undefined) delete process.env.ASTRALE_HOME
  else process.env.ASTRALE_HOME = previousHome
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

function machine(name: string): string {
  const root = mkdtempSync(join(tmpdir(), `studio-harness-gateway-${name}-`))
  roots.push(root)
  process.env.ASTRALE_HOME = join(root, '.astrale')
  return root
}

test('owns normalized machine gateway configuration and child environment', async () => {
  machine('config')

  const state = setHarnessGateway({
    enabled: true,
    baseUrl: ' https://gateway.example/v1/models/demo ',
    model: ' demo-model ',
    auth: { mode: 'token', token: ' secret ' },
  })
  expect(state).toMatchObject({
    source: 'machine',
    effective: {
      enabled: true,
      baseUrl: 'https://gateway.example/v1/models/demo',
      model: 'demo-model',
      auth: { mode: 'token', token: 'secret' },
    },
  })
  expect(await resolveHarnessEnv()).toEqual({
    ok: true,
    env: {
      ANTHROPIC_BASE_URL: 'https://gateway.example/v1/models/demo',
      ANTHROPIC_AUTH_TOKEN: 'secret',
      ANTHROPIC_MODEL: 'demo-model',
      ANTHROPIC_SMALL_FAST_MODEL: 'demo-model',
    },
  })
  expect(statSync(statePath(studioHome(), 'harness-gateway.json')).mode & 0o777).toBe(0o600)

  clearHarnessGateway()
  expect(getHarnessGatewayState()).toEqual({ config: null, effective: null, source: 'none' })
})

test('rejects enabled gateway configurations that cannot authenticate safely', () => {
  machine('invalid')

  expect(() => setHarnessGateway({ enabled: true, baseUrl: '', auth: { mode: 'mint' } })).toThrow(
    'gateway base URL is required',
  )
  expect(() =>
    setHarnessGateway({
      enabled: true,
      baseUrl: 'file:///tmp/gateway',
      auth: { mode: 'mint' },
    }),
  ).toThrow('must use http:// or https://')
  expect(() =>
    setHarnessGateway({
      enabled: true,
      baseUrl: 'https://gateway.example',
      auth: { mode: 'token', token: ' ' },
    }),
  ).toThrow('static token is required')
})

test('fails closed for invalid enabled configuration already present on disk', async () => {
  machine('stored-invalid')
  writeJson(studioHome(), 'harness-gateway.json', {
    enabled: true,
    baseUrl: '',
    auth: { mode: 'mint' },
  })

  expect(await resolveHarnessEnv()).toEqual({
    ok: false,
    error: 'gateway base URL is required while enabled',
  })
})
