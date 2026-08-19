import { afterEach, describe, expect, test } from 'bun:test'
import { closeSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ViewServeConfig } from '../view/session'

import {
  configPath,
  logPath,
  openSessionLog,
  recordPath,
  removeSessionFiles,
  saveRecord,
  saveServeConfig,
} from '../view/session'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  )
})

function mode(value: Awaited<ReturnType<typeof stat>>): number {
  return Number(value.mode) & 0o777
}

const target = (value: string) => value as ViewServeConfig['session']['view']['target']
const issuer = (value: string) => value as ViewServeConfig['session']['view']['route']['issuer']
const revision = (character: string) =>
  `sha256:${character.repeat(64)}` as ViewServeConfig['session']['view']['route']['revision']

describe('view session private state', () => {
  /** @evidence TEST-CLI-VIEW-CREDENTIAL-CONFIG-IS-OWNER-ONLY */
  test('repairs directory/log modes and atomically stores raw carriers as 0600', async () => {
    const root = await mkdtemp(join(tmpdir(), 'astrale-view-state-'))
    temporaryDirectories.push(root)
    const directory = join(root, 'view')
    await mkdir(directory, { mode: 0o755 })
    await chmod(directory, 0o755)

    const config = {
      session: {
        id: 'v-a1b2c3',
        pid: 0,
        port: 4419,
        nonce: 'nonce',
        pageUrl: 'http://127.0.0.1:4419/s/nonce/',
        view: {
          target: target('/:example.test'),
          route: {
            key: 'example.test:view.main',
            href: 'https://example.test/ui',
            handshake: 'shell',
            issuer: issuer('https://example.test'),
            etag: `sha256:${'a'.repeat(64)}`,
            revision: revision('b'),
            declaration: { target: { kind: 'domain' }, auth: 'required' },
          },
        },
        createdAt: '2026-08-12T00:00:00.000Z',
      },
      kernel: { creds: 'raw-secret-carrier' },
      proxy: {
        kernelUrl: 'https://kernel.test',
        issuer: 'https://kernel.test',
        direct: true,
      },
      idleMs: 60_000,
    } satisfies ViewServeConfig

    await saveServeConfig(config, directory)
    await saveRecord(config.session, directory)
    const descriptor = await openSessionLog(config.session.id, directory)
    closeSync(descriptor)

    expect(mode(await stat(directory))).toBe(0o700)
    expect(mode(await stat(configPath(config.session.id, directory)))).toBe(0o600)
    expect(mode(await stat(recordPath(config.session.id, directory)))).toBe(0o600)
    expect(mode(await stat(logPath(config.session.id, directory)))).toBe(0o600)
    expect(await readFile(configPath(config.session.id, directory), 'utf8')).toContain(
      'raw-secret-carrier',
    )

    await removeSessionFiles(config.session.id, directory)
    await expect(stat(configPath(config.session.id, directory))).rejects.toMatchObject({
      code: 'ENOENT',
    })
    await expect(stat(recordPath(config.session.id, directory))).rejects.toMatchObject({
      code: 'ENOENT',
    })
    await expect(stat(logPath(config.session.id, directory))).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })
})
