import { chmod, copyFile, mkdir, rename, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { acquireInstallLock } from './install-lock'

type CohortFilesystem = Readonly<{
  chmod: typeof chmod
  copyFile: typeof copyFile
  mkdir: typeof mkdir
  rename: typeof rename
  rm: typeof rm
  stat: typeof stat
}>

const defaultFilesystem: CohortFilesystem = { chmod, copyFile, mkdir, rename, rm, stat }

export type StandaloneCohortInput = Readonly<{
  installedBinary: string
  nextBinary: string
  nextCloudflared?: string
  installedLicense?: string
  nextLicense?: string
}>

export type StandaloneCohortReplacement = Readonly<{
  finalize(): Promise<void>
  rollback(): Promise<void>
}>

type Component = Readonly<{
  installed: string
  next: string
  staged: string
  previous: string
  existed: boolean
  mode: number
}>

async function exists(path: string, filesystem: CohortFilesystem): Promise<boolean> {
  try {
    await filesystem.stat(path)
    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
    throw error
  }
}

async function stage(
  installed: string,
  next: string,
  mode: number,
  filesystem: CohortFilesystem,
): Promise<Component> {
  const component = {
    installed,
    next,
    staged: `${installed}.next`,
    previous: `${installed}.previous`,
    existed: await exists(installed, filesystem),
    mode,
  }
  await filesystem.mkdir(dirname(installed), { recursive: true })
  await filesystem.rm(component.staged, { force: true })
  try {
    if (component.existed) await filesystem.copyFile(installed, component.previous)
    else await filesystem.rm(component.previous, { force: true })
    await filesystem.copyFile(next, component.staged)
    await filesystem.chmod(component.staged, mode)
  } catch (error) {
    await filesystem.rm(component.staged, { force: true }).catch(() => undefined)
    await filesystem.rm(component.previous, { force: true }).catch(() => undefined)
    throw error
  }
  return component
}

async function restore(component: Component, filesystem: CohortFilesystem): Promise<void> {
  if (component.existed) {
    await filesystem.copyFile(component.previous, component.installed)
    await filesystem.chmod(component.installed, component.mode)
  } else {
    await filesystem.rm(component.installed, { force: true })
  }
}

async function cleanup(component: Component, filesystem: CohortFilesystem): Promise<void> {
  await filesystem.rm(component.staged, { force: true })
  await filesystem.rm(component.previous, { force: true })
}

/**
 * Stage the whole cohort, then expose the private provider before the CLI that
 * consumes it. Failures roll every committed component back until metadata
 * commits through `finalize()`.
 */
export async function replaceStandaloneCohort(
  input: StandaloneCohortInput,
  dependencies: Partial<CohortFilesystem> = {},
): Promise<StandaloneCohortReplacement> {
  const filesystem = { ...defaultFilesystem, ...dependencies }
  const lock = await acquireInstallLock(input.installedBinary)
  const installedCloudflared = join(dirname(input.installedBinary), 'astrale-cloudflared')
  const components: Component[] = []

  try {
    if (input.nextLicense && input.installedLicense) {
      components.push(await stage(input.installedLicense, input.nextLicense, 0o644, filesystem))
    }
    if (input.nextCloudflared) {
      components.push(await stage(installedCloudflared, input.nextCloudflared, 0o755, filesystem))
    }
    components.push(await stage(input.installedBinary, input.nextBinary, 0o755, filesystem))
  } catch (error) {
    await Promise.all(
      components.map((component) => cleanup(component, filesystem).catch(() => undefined)),
    )
    await lock.release()
    throw error
  }

  const committed: Component[] = []
  try {
    for (const component of components) {
      await filesystem.rename(component.staged, component.installed)
      committed.push(component)
    }
  } catch (error) {
    const rollback: unknown[] = []
    for (const component of [...committed].reverse()) {
      await restore(component, filesystem).catch((failure) => rollback.push(failure))
    }
    if (rollback.length === 0) {
      await Promise.all(components.map((component) => cleanup(component, filesystem)))
    }
    await lock.release().catch((failure) => rollback.push(failure))
    if (rollback.length > 0) {
      throw new AggregateError([error, ...rollback], 'Standalone update and rollback both failed.')
    }
    throw error
  } finally {
    await Promise.all(
      components.map((component) => filesystem.rm(component.staged, { force: true })),
    )
  }

  let settled = false
  return Object.freeze({
    finalize: async () => {
      if (settled) return
      settled = true
      try {
        await Promise.all(
          components.map((component) => filesystem.rm(component.previous, { force: true })),
        )
      } finally {
        await lock.release()
      }
    },
    rollback: async () => {
      if (settled) return
      settled = true
      const failures: unknown[] = []
      for (const component of [...components].reverse()) {
        await restore(component, filesystem).catch((failure) => failures.push(failure))
      }
      if (failures.length === 0) {
        for (const component of components) {
          await cleanup(component, filesystem).catch((failure) => failures.push(failure))
        }
      }
      await lock.release().catch((failure) => failures.push(failure))
      if (failures.length > 0) {
        throw new AggregateError(failures, 'Standalone update rollback failed.')
      }
    },
  })
}
