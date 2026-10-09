import { chmod, copyFile, rename, rm } from 'node:fs/promises'

import { acquireInstallLock } from './install-lock'

type BinaryFilesystem = Readonly<{
  chmod: typeof chmod
  copyFile: typeof copyFile
  rename: typeof rename
  rm: typeof rm
}>

export type StandaloneBinaryReplacement = Readonly<{
  finalize(): Promise<void>
  rollback(): Promise<void>
}>

/** Replace the admitted executable, retaining rollback until install metadata commits. */
export async function replaceStandaloneBinary(
  input: Readonly<{ installedBinary: string; nextBinary: string }>,
  dependencies: Partial<BinaryFilesystem> = {},
): Promise<StandaloneBinaryReplacement> {
  const filesystem = { chmod, copyFile, rename, rm, ...dependencies }
  const lock = await acquireInstallLock(input.installedBinary)
  const staged = `${input.installedBinary}.next`
  const previous = `${input.installedBinary}.previous`
  try {
    await filesystem.copyFile(input.installedBinary, previous)
    await filesystem.copyFile(input.nextBinary, staged)
    await filesystem.chmod(staged, 0o755)
    await filesystem.rename(staged, input.installedBinary)
  } catch (error) {
    const failures: unknown[] = []
    await filesystem.rm(staged, { force: true }).catch((failure) => failures.push(failure))
    // The atomic rename did not commit; the installed executable is unchanged.
    await filesystem.rm(previous, { force: true }).catch((failure) => failures.push(failure))
    await lock.release().catch((failure) => failures.push(failure))
    if (failures.length > 0) {
      throw new AggregateError([error, ...failures], 'Standalone update staging cleanup failed.')
    }
    throw error
  }

  let settled = false
  return Object.freeze({
    async finalize() {
      if (settled) return
      settled = true
      try {
        await filesystem.rm(previous, { force: true })
      } finally {
        await lock.release()
      }
    },
    async rollback() {
      if (settled) return
      settled = true
      const failures: unknown[] = []
      // Rename restores atomically and retains the backup if restoration fails.
      await filesystem
        .rename(previous, input.installedBinary)
        .catch((failure) => failures.push(failure))
      await lock.release().catch((failure) => failures.push(failure))
      if (failures.length > 0) {
        throw new AggregateError(failures, 'Standalone update rollback failed.')
      }
    },
  })
}
