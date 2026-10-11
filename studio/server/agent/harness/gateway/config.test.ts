import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { studioHome } from '../../../state/home'
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

test('an enabled gateway that cannot authenticate safely is refused, and fails closed from disk', async () => {
  machine('invalid')
  for (const [config, error] of [
    [{ baseUrl: '', auth: { mode: 'mint' } }, 'gateway base URL is required'],
    [{ baseUrl: 'file:///tmp/gateway', auth: { mode: 'mint' } }, 'must use http:// or https://'],
    [
      { baseUrl: 'https://gateway.example', auth: { mode: 'token', token: ' ' } },
      'static token is required',
    ],
  ] as const)
    expect(() => setHarnessGateway({ enabled: true, ...config })).toThrow(error)

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
