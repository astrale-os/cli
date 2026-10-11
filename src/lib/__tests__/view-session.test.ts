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
  saveRecord,
  saveServeConfig,
} from '../view/session'
import { viewConfig } from './view.fixture'

type Signal = Parameters<typeof process.kill>[1]

const temporaryDirectories: string[] = []
let killSpy: ReturnType<typeof spyOn<typeof process, 'kill'>> | undefined

afterEach(async () => {
  killSpy?.mockRestore()
  killSpy = undefined
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  )
})

const processError = (code: string) => Object.assign(new Error(`kill ${code}`), { code })
const files = (id: string, directory: string) => [
  recordPath(id, directory),
  configPath(id, directory),
  logPath(id, directory),
]

/** A stored session whose process answers each signal with `signal`. */
async function sessionOf(signal: (value: Signal) => true) {
  const directory = await mkdtemp(join(tmpdir(), 'astrale-view-process-'))
  temporaryDirectories.push(directory)
  const base = viewConfig('a1b2c3')
  const config: ViewServeConfig = {
    ...base,
    session: {
      ...base.session,
      pid: 246801,
      port: 4419,
      pageUrl: 'http://127.0.0.1:4419/s/a1b2c3/',
    },
  }
  await saveServeConfig(config, directory)
  await saveRecord(config.session, directory)
  closeSync(await openSessionLog(config.session.id, directory))
  const originalKill = process.kill.bind(process)
  killSpy = spyOn(process, 'kill').mockImplementation((pid, value) =>
    pid === config.session.pid ? signal(value) : originalKill(pid, value),
  )
  const retained = async (kept: boolean) => {
    expect(await listSessions(directory)).toEqual(kept ? [config.session] : [])
    for (const path of files(config.session.id, directory)) {
      if (kept) expect(await stat(path)).toBeDefined()
      else await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' })
    }
  }
  return { directory, session: config.session, retained }
}

describe('view session process ownership', () => {
  /** @evidence TEST-CLI-VIEW-PROCESS-EPERM-RETAINS-CATALOG */
  test.each([
    ['EPERM', true],
    ['EACCES', true],
    ['EIO', true],
    ['ESRCH', false],
  ] as const)('a listing probe answering %s retains the session: %p', async (code, kept) => {
    const { retained } = await sessionOf(() => {
      throw processError(code)
    })
    await retained(kept)
  })

  /** @evidence TEST-CLI-VIEW-CLOSE-EPERM-RETAINS-CATALOG */
  test.each([
    [
      'a denied SIGTERM',
      'SIGTERM failed: kill EPERM',
      () => (s: Signal) => {
        if (s === 0) return true
        throw processError('EPERM')
      },
    ],
    [
      'a denied SIGKILL after the grace period',
      'SIGKILL failed: kill EPERM',
      () => (s: Signal) => {
        if (s === 'SIGKILL') throw processError('EPERM')
        return true
      },
    ],
    [
      'signals that never establish an exit',
      'exit could not be confirmed',
      () => () => true as const,
    ],
  ] as const)('close retains the session on %s', async (_name, message, behaviour) => {
    const { directory, session, retained } = await sessionOf(behaviour() as (s: Signal) => true)
    await expect(closeSession(session, directory)).rejects.toThrow(message)
    await retained(true)
  })

  test.each([
    [
      'was already gone, sending it nothing',
      () =>
        (s: Signal): true => {
          if (s !== 0) throw new Error(`${String(s)} sent to a gone process`)
          throw processError('ESRCH')
        },
    ],
    [
      'disappears between the probe and SIGTERM',
      () =>
        (s: Signal): true => {
          if (s === 0) return true
          throw processError('ESRCH')
        },
    ],
    [
      'exits after SIGTERM',
      () => {
        let running = true
        return (s: Signal): true => {
          if (s === 'SIGTERM') running = false
          if (!running && s === 0) throw processError('ESRCH')
          return true
        }
      },
    ],
    [
      'exits only after SIGKILL, confirmed by later probes',
      () => {
        let killed = false
        let probes = 0
        return (s: Signal): true => {
          if (s === 'SIGKILL') killed = true
          if (s === 0 && killed && ++probes >= 3) throw processError('ESRCH')
          return true
        }
      },
    ],
  ] as const)('close removes a session that %s', async (_name, behaviour) => {
    const { directory, session, retained } = await sessionOf(behaviour())
    await closeSession(session, directory)
    await retained(false)
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
    const config = viewConfig('nonce', { kernel: { creds: 'raw-secret-carrier' } })

    await saveServeConfig(config, directory)
    await saveRecord(config.session, directory)
    closeSync(await openSessionLog(config.session.id, directory))

    const mode = async (path: string) => Number((await stat(path)).mode) & 0o777
    expect(await mode(directory)).toBe(0o700)
    for (const path of files(config.session.id, directory)) expect(await mode(path)).toBe(0o600)
    expect(JSON.parse(await readFile(configPath(config.session.id, directory), 'utf8'))).toEqual(
      config,
    )
  })
})
