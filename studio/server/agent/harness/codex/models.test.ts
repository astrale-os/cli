import { afterEach, expect, test } from 'bun:test'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { probeCodexModels } from './models'

const roots: string[] = []

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

function fakeCodex(root: string): string {
  const file = join(root, 'fake-codex')
  writeFileSync(
    file,
    `#!/usr/bin/env bun
const fs = require('node:fs')
let buffer = ''
const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n')
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let newline
  while ((newline = buffer.indexOf('\\n')) >= 0) {
    const line = buffer.slice(0, newline).trim()
    buffer = buffer.slice(newline + 1)
    if (!line) continue
    const message = JSON.parse(line)
    const mode = process.env.FAKE_MODEL_MODE
    if (process.env.FAKE_MODEL_LOG) fs.appendFileSync(process.env.FAKE_MODEL_LOG, line + '\\n')
    if (message.method === 'initialize') {
      if (mode === 'early-close') {
        console.error('probe crashed before initialization')
        process.exit(7)
      }
      if (mode !== 'timeout') send({ id: message.id, result: { userAgent: 'fake' } })
    }
    if (message.method === 'config/read') {
      if (mode === 'rpc-error') send({ id: message.id, error: { message: 'config denied' } })
      else if (mode === 'malformed-config') send({ id: message.id, result: { origins: {} } })
      else send({ id: message.id, result: { config: { model: 'gpt-configured' }, origins: {} } })
    }
    if (message.method === 'model/list') {
      send({
        id: message.id,
        result: {
          data: mode === 'malformed-models' ? {} : [
            { id: 'default', model: 'gpt-default', displayName: 'Default GPT', description: 'default model', isDefault: true },
            { id: 'fast', model: 'gpt-fast', displayName: 'Fast GPT', description: 'fast model', isDefault: false },
          ],
          nextCursor: null,
        },
      })
    }
  }
})
`,
  )
  chmodSync(file, 0o755)
  return file
}

test('resolves Codex config and live catalog through the app-server protocol', async () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-codex-models-'))
  roots.push(root)
  const log = join(root, 'requests.jsonl')

  const result = await probeCodexModels(fakeCodex(root), root, undefined, {
    FAKE_MODEL_LOG: log,
  })

  expect(result).toEqual({
    ok: true,
    nativeModel: 'gpt-configured',
    model: 'gpt-configured',
    modelSource: 'config',
    models: [
      {
        id: 'gpt-default',
        label: 'Default GPT',
        description: 'default model',
        isDefault: true,
      },
      {
        id: 'gpt-fast',
        label: 'Fast GPT',
        description: 'fast model',
        isDefault: false,
      },
    ],
    detail: 'Codex resolves gpt-configured from its effective config.',
  })
  const requests = readFileSync(log, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  expect(requests.map((request) => request.method)).toEqual([
    'initialize',
    'initialized',
    'config/read',
    'model/list',
  ])
  expect(requests[2].params).toEqual({ cwd: root, includeLayers: false })
  expect(requests[3].params).toEqual({ includeHidden: false, limit: 100 })
})

test('keeps the native Codex model visible while a Studio override wins', async () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-codex-model-override-'))
  roots.push(root)

  const result = await probeCodexModels(fakeCodex(root), root, 'gpt-fast')

  expect(result).toMatchObject({
    ok: true,
    nativeModel: 'gpt-configured',
    model: 'gpt-fast',
    modelSource: 'studio',
  })
  expect(result.detail).toBe('Codex resolves gpt-fast from this Studio domain.')
})

test.each([
  ['malformed-config', 'Codex config probe returned an invalid response'],
  ['malformed-models', 'Codex model catalog returned an invalid response'],
  ['rpc-error', 'config denied'],
] as const)('fails closed on %s app-server protocol responses', async (mode, detail) => {
  const root = mkdtempSync(join(tmpdir(), `studio-codex-model-${mode}-`))
  roots.push(root)

  const result = await probeCodexModels(fakeCodex(root), root, undefined, {
    FAKE_MODEL_MODE: mode,
  })

  expect(result.ok).toBe(false)
  expect(result.detail).toBe(detail)
})

test('reports spawn, early-close, and timeout failures without hanging', async () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-codex-model-failures-'))
  roots.push(root)
  const bin = fakeCodex(root)

  const missing = await probeCodexModels(join(root, 'missing-codex'), root)
  expect(missing).toMatchObject({
    ok: false,
    models: [],
  })
  expect(missing.detail).toContain('failed to spawn')

  const early = await probeCodexModels(bin, root, undefined, {
    FAKE_MODEL_MODE: 'early-close',
  })
  expect(early.ok).toBe(false)
  expect(early.detail).toContain('probe crashed before initialization')

  const timedOut = await probeCodexModels(bin, root, undefined, { FAKE_MODEL_MODE: 'timeout' }, 50)
  expect(timedOut).toEqual({
    ok: false,
    nativeModel: undefined,
    model: undefined,
    modelSource: undefined,
    models: [],
    detail: 'Codex model probe timed out',
  })
})
