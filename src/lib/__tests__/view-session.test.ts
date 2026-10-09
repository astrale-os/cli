import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { closeSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ViewServeConfig } from '../view/session'

import {
  configPath,
  closeSession,
  listSessions,
  logPath,
  openSessionLog,
  recordPath,
  removeSessionFiles,
  saveRecord,
  saveServeConfig,
} from '../view/session'

const temporaryDirectories: string[] = []
let killSpy: ReturnType<typeof spyOn<typeof process, 'kill'>> | undefined

afterEach(async () => {
  killSpy?.mockRestore()
  killSpy = undefined
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

function processError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`kill ${code}`), { code })
}

async function sessionFixture(): Promise<{ directory: string; config: ViewServeConfig }> {
  const directory = await mkdtemp(join(tmpdir(), 'astrale-view-process-'))
  temporaryDirectories.push(directory)
  const config: ViewServeConfig = {
    session: {
      id: 'v-a1b2c3',
      pid: 246801,
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
          release: `sha256:${'a'.repeat(64)}`,
          revision: revision('b'),
          declaration: { target: { kind: 'domain' } },
        },
      },
      createdAt: '2026-10-06T00:00:00.000Z',
    },
    kernel: {},
    proxy: { kernelUrl: 'https://kernel.test', issuer: 'https://kernel.test', direct: true },
    externalOrigins: [],
    idleMs: 60_000,
  }
  await saveServeConfig(config, directory)
  await saveRecord(config.session, directory)
  closeSync(await openSessionLog(config.session.id, directory))
  return { directory, config }
}

function mockSessionProcess(
  pid: number,
  signal: (signal: Parameters<typeof process.kill>[1]) => true,
): void {
  const originalKill = process.kill.bind(process)
  killSpy = spyOn(process, 'kill').mockImplementation((targetPid, value) =>
    targetPid === pid ? signal(value) : originalKill(targetPid, value),
  )
}

async function expectSessionFiles(
  directory: string,
  config: ViewServeConfig,
  retained: boolean,
): Promise<void> {
  for (const path of [
    recordPath(config.session.id, directory),
    configPath(config.session.id, directory),
    logPath(config.session.id, directory),
  ]) {
    if (retained) expect(await stat(path)).toBeDefined()
    else await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' })
  }
}

describe('view session process ownership', () => {
  /** @evidence TEST-CLI-VIEW-PROCESS-EPERM-RETAINS-CATALOG */
  test.each(['EPERM', 'EACCES', 'EIO'])(
    'retains session files when a probe returns %s',
    async (code) => {
      const { directory, config } = await sessionFixture()
      mockSessionProcess(config.session.pid, () => {
        throw processError(code)
      })

      expect(await listSessions(directory)).toEqual([config.session])
      await expectSessionFiles(directory, config, true)
    },
  )

  test('removes session files when ESRCH confirms the process is gone', async () => {
    const { directory, config } = await sessionFixture()
    mockSessionProcess(config.session.pid, () => {
      throw processError('ESRCH')
    })

    expect(await listSessions(directory)).toEqual([])
    await expectSessionFiles(directory, config, false)
  })

  /** @evidence TEST-CLI-VIEW-CLOSE-EPERM-RETAINS-CATALOG */
  test('rejects a denied SIGTERM and retains the session even when its probe is denied', async () => {
    const { directory, config } = await sessionFixture()
    const signals: Parameters<typeof process.kill>[1][] = []
    mockSessionProcess(config.session.pid, (signal) => {
      signals.push(signal)
      throw processError('EPERM')
    })

    await expect(closeSession(config.session, directory)).rejects.toThrow(
      'SIGTERM failed: kill EPERM',
    )
    expect(signals).toEqual([0, 'SIGTERM'])
    await expectSessionFiles(directory, config, true)
    expect(await listSessions(directory)).toEqual([config.session])
  })

  test('removes a session that was already gone without sending a termination signal', async () => {
    const { directory, config } = await sessionFixture()
    const signals: Parameters<typeof process.kill>[1][] = []
    mockSessionProcess(config.session.pid, (signal) => {
      signals.push(signal)
      throw processError('ESRCH')
    })

    await closeSession(config.session, directory)
    expect(signals).toEqual([0])
    await expectSessionFiles(directory, config, false)
  })

  test('removes a session that disappears between the probe and SIGTERM', async () => {
    const { directory, config } = await sessionFixture()
    mockSessionProcess(config.session.pid, (signal) => {
      if (signal === 0) return true
      throw processError('ESRCH')
    })

    await closeSession(config.session, directory)
    await expectSessionFiles(directory, config, false)
  })

  test('removes a session after observing its exit following SIGTERM', async () => {
    const { directory, config } = await sessionFixture()
    let running = true
    mockSessionProcess(config.session.pid, (signal) => {
      if (signal === 'SIGTERM') running = false
      if (!running && signal === 0) throw processError('ESRCH')
      return true
    })

    await closeSession(config.session, directory)
    await expectSessionFiles(directory, config, false)
  })

  test('retains a session if SIGKILL is denied after the SIGTERM grace period', async () => {
    const { directory, config } = await sessionFixture()
    mockSessionProcess(config.session.pid, (signal) => {
      if (signal === 'SIGKILL') throw processError('EPERM')
      return true
    })

    await expect(closeSession(config.session, directory)).rejects.toThrow(
      'SIGKILL failed: kill EPERM',
    )
    await expectSessionFiles(directory, config, true)
    expect(await listSessions(directory)).toEqual([config.session])
  })

  test('waits for confirmed exit after SIGKILL before dropping the session files', async () => {
    const { directory, config } = await sessionFixture()
    let killed = false
    let postKillProbes = 0
    mockSessionProcess(config.session.pid, (signal) => {
      if (signal === 'SIGKILL') killed = true
      if (signal === 0 && killed && ++postKillProbes >= 3) throw processError('ESRCH')
      return true
    })

    await closeSession(config.session, directory)
    expect(postKillProbes).toBeGreaterThanOrEqual(3)
    await expectSessionFiles(directory, config, false)
  })

  test('retains a session when successful signals never establish that the process exited', async () => {
    const { directory, config } = await sessionFixture()
    mockSessionProcess(config.session.pid, () => true)

    await expect(closeSession(config.session, directory)).rejects.toThrow(
      'exit could not be confirmed',
    )
    await expectSessionFiles(directory, config, true)
    expect(await listSessions(directory)).toEqual([config.session])
  })
})

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
            release: `sha256:${'a'.repeat(64)}`,
            revision: revision('b'),
            declaration: { target: { kind: 'domain' } },
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
      externalOrigins: [],
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
    expect(JSON.parse(await readFile(configPath(config.session.id, directory), 'utf8'))).toEqual(
      config,
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
