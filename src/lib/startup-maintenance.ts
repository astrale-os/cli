import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

import pkg from '../../package.json' with { type: 'json' }
import { paths } from '../state'
import { atomicWrite } from '../state/files'
import { log } from './log'
import { runInherit } from './proc'
import { confirmDefaultYes, promptSelect } from './prompt'
import { checkAstraleSkills, syncAstraleSkills } from './skills'
import {
  DEFAULT_UPDATE_CHANNEL,
  detectUpdateExecution,
  readInstallMetadata,
  updateAstrale,
} from './update'

const CACHE_VERSION = 1
const CACHE_TTL_MS = 24 * 60 * 60 * 1_000
const CHECK_TIMEOUT_MS = 4_000
const REEXEC_ENV = 'ASTRALE_UPDATE_REEXEC'

type UpdateNoticeCache = {
  version: typeof CACHE_VERSION
  checkedAt: string
  currentVersion: string
  latestVersion: string
  channel: string
  dismissedVersion?: string
}

type AvailableRelease = {
  currentVersion: string
  latestVersion: string
  channel: string
  dismissed: boolean
}

function cachePath(): string {
  return join(paths.home, 'update-notice.json')
}

function parseCache(value: unknown): UpdateNoticeCache | undefined {
  if (!value || typeof value !== 'object') return undefined
  const cache = value as Partial<UpdateNoticeCache>
  if (
    cache.version !== CACHE_VERSION ||
    typeof cache.checkedAt !== 'string' ||
    typeof cache.currentVersion !== 'string' ||
    typeof cache.latestVersion !== 'string' ||
    typeof cache.channel !== 'string' ||
    (cache.dismissedVersion !== undefined && typeof cache.dismissedVersion !== 'string')
  ) {
    return undefined
  }
  return cache as UpdateNoticeCache
}

async function readCache(): Promise<UpdateNoticeCache | undefined> {
  try {
    return parseCache(JSON.parse(await readFile(cachePath(), 'utf8')))
  } catch {
    return undefined
  }
}

async function writeCache(cache: UpdateNoticeCache): Promise<void> {
  await atomicWrite(cachePath(), `${JSON.stringify(cache, null, 2)}\n`).catch(() => undefined)
}

function cacheFresh(cache: UpdateNoticeCache, currentVersion: string, channel: string): boolean {
  const checkedAt = Date.parse(cache.checkedAt)
  return (
    Number.isFinite(checkedAt) &&
    Date.now() - checkedAt < CACHE_TTL_MS &&
    cache.currentVersion === currentVersion &&
    cache.channel === channel
  )
}

async function availableRelease(): Promise<AvailableRelease | undefined> {
  const execution = detectUpdateExecution()
  if (execution.kind !== 'standalone') return undefined

  const metadata = await readInstallMetadata().catch(() => undefined)
  if (!metadata) return undefined
  const currentVersion = metadata.version ?? pkg.version
  const channel = metadata.channel ?? DEFAULT_UPDATE_CHANNEL
  const cached = await readCache()
  if (cached && cacheFresh(cached, currentVersion, channel)) {
    if (cached.latestVersion === currentVersion) return undefined
    return {
      currentVersion,
      latestVersion: cached.latestVersion,
      channel: cached.channel,
      dismissed: cached.dismissedVersion === cached.latestVersion,
    }
  }

  try {
    const result = await updateAstrale({
      check: true,
      currentVersion: pkg.version,
      execution,
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    })
    if (result.status === 'repair-available') {
      await writeCache({
        version: CACHE_VERSION,
        checkedAt: new Date().toISOString(),
        currentVersion: result.currentVersion,
        latestVersion: result.currentVersion,
        channel: result.channel,
      })
      return undefined
    }
    if (result.status !== 'available' && result.status !== 'up-to-date') return undefined
    const next: UpdateNoticeCache = {
      version: CACHE_VERSION,
      checkedAt: new Date().toISOString(),
      currentVersion: result.currentVersion,
      latestVersion: result.latestVersion,
      channel: result.channel,
      ...(cached?.dismissedVersion === result.latestVersion
        ? { dismissedVersion: result.latestVersion }
        : {}),
    }
    await writeCache(next)
    if (result.status === 'up-to-date') return undefined
    return {
      currentVersion: result.currentVersion,
      latestVersion: result.latestVersion,
      channel: result.channel,
      dismissed: next.dismissedVersion === result.latestVersion,
    }
  } catch {
    // Cache failures too: an offline shell should not pay the timeout on every
    // command. Explicit `astrale update` still keeps full errors and retries.
    await writeCache({
      version: CACHE_VERSION,
      checkedAt: new Date().toISOString(),
      currentVersion,
      latestVersion: currentVersion,
      channel,
      ...(cached?.dismissedVersion ? { dismissedVersion: cached.dismissedVersion } : {}),
    })
    return undefined
  }
}

export function shouldRunStartupMaintenance(
  argv: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
  tty = process.stdin.isTTY === true && process.stdout.isTTY === true,
): boolean {
  if (!tty || environment.CI || environment.CONTINUOUS_INTEGRATION || environment[REEXEC_ENV]) {
    return false
  }
  const args = argv.slice(2)
  if (args.length === 0) return false
  if (args.some((arg) => ['--json', '--raw', '--ci', '--no-prompt'].includes(arg))) return false
  if (args.some((arg) => ['--help', '-h', '--version', '--cli-version', '-V'].includes(arg))) {
    return false
  }
  return !['update', 'skills', 'setup'].includes(args[0] ?? '')
}

async function updateAndReexec(
  release: AvailableRelease,
  argv: readonly string[],
): Promise<boolean> {
  const execution = detectUpdateExecution()
  if (execution.kind !== 'standalone') return false
  log.step(`Updating Astrale ${release.currentVersion} → ${release.latestVersion}`)
  const environment = { ...process.env, [REEXEC_ENV]: '1' }
  const updated = await runInherit(execution.executable, ['update', '--no-deps'], {
    env: environment,
  })
  if (updated !== 0) {
    log.warn('Automatic update did not complete; continuing with the current command.')
    return false
  }
  await rm(cachePath(), { force: true }).catch(() => undefined)
  const resumed = await runInherit(execution.executable, argv.slice(2), { env: environment })
  process.exitCode = resumed
  return true
}

async function offerReleaseUpdate(argv: readonly string[]): Promise<boolean> {
  const release = await availableRelease()
  if (!release || release.dismissed) return false
  const action = await promptSelect(
    `Astrale ${release.latestVersion} is available (current: ${release.currentVersion}).`,
    [
      { name: 'Update now (recommended)', value: 'update' as const },
      { name: 'Later', value: 'later' as const },
      {
        name: `Do not offer ${release.latestVersion} again`,
        value: 'dismiss' as const,
      },
    ],
  )
  if (action === 'dismiss') {
    const cached = await readCache()
    if (cached) await writeCache({ ...cached, dismissedVersion: release.latestVersion })
    return false
  }
  return action === 'update' ? updateAndReexec(release, argv) : false
}

async function offerSkillMaintenance(): Promise<void> {
  const state = await checkAstraleSkills()
  if (state.installed === false) {
    const { configureAstraleSkills, renderSkillConfigureOutcome } =
      await import('../commands/skills/configure')
    try {
      renderSkillConfigureOutcome(await configureAstraleSkills({ source: 'reminder' }))
    } catch (error) {
      log.warn(
        `Skill configuration could not be offered; run \`astrale skills configure\`. ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    return
  }
  if (state.status !== 'update-available' && state.status !== 'repair-needed') return
  const label = state.status === 'repair-needed' ? 'need repair' : 'have an update available'
  if (!(await confirmDefaultYes(`Astrale agent skills ${label}. Update them now?`))) return
  try {
    const result = await syncAstraleSkills()
    if (result.status !== 'unchanged') log.success('Astrale agent skills are current')
  } catch (error) {
    log.warn(
      `Automatic skill update failed; run \`astrale skills update\`. ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/** Interactive, cached startup maintenance. Returns true after re-executing the command. */
export async function maybeRunStartupMaintenance(argv: readonly string[]): Promise<boolean> {
  if (!shouldRunStartupMaintenance(argv)) return false
  if (await offerReleaseUpdate(argv)) return true
  await offerSkillMaintenance()
  return false
}
