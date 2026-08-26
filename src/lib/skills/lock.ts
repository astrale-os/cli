import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export type FileLockOptions = {
  pollIntervalMs?: number
  staleAfterMs?: number
  timeoutMs?: number
}

type Claim = { directory: string; pid: number; ticket: number | null; choosing: boolean }

/**
 * Serialize a cross-process transition with a filesystem bakery lock.
 *
 * Every contender owns a UUID directory for its entire lifetime. Dead claims are
 * removed only by that unrepeatable name, so recovery never deletes a pathname a
 * new live owner could have replaced between an ownership check and an unlink.
 */
export async function withFileLock<T>(
  lockPath: string,
  fn: () => Promise<T>,
  opts: FileLockOptions = {},
): Promise<T> {
  const pollIntervalMs = opts.pollIntervalMs ?? 100
  const staleAfterMs = opts.staleAfterMs ?? 30_000
  const timeoutMs = opts.timeoutMs ?? 60_000
  const deadline = Date.now() + timeoutMs
  const claimsRoot = `${lockPath}.claims`
  const token = randomUUID()
  const claimDirectory = join(claimsRoot, token)

  await mkdir(dirname(lockPath), { recursive: true })
  await mkdir(claimsRoot, { recursive: true })
  await mkdir(claimDirectory)
  await writeFile(join(claimDirectory, 'owner.json'), JSON.stringify({ pid: process.pid }), {
    mode: 0o600,
  })
  await writeFile(join(claimDirectory, 'choosing'), '', { mode: 0o600 })

  try {
    const claims = await liveClaims(claimsRoot, staleAfterMs)
    const ticket = Math.max(0, ...claims.flatMap((claim) => claim.ticket ?? [])) + 1
    await writeFile(join(claimDirectory, 'ticket'), String(ticket), { mode: 0o600 })
    await unlink(join(claimDirectory, 'choosing'))

    for (;;) {
      const contenders = await liveClaims(claimsRoot, staleAfterMs)
      const blocked = contenders.some(
        (claim) =>
          claim.directory !== claimDirectory &&
          (claim.choosing ||
            claim.ticket === null ||
            claim.ticket < ticket ||
            (claim.ticket === ticket && claim.directory < claimDirectory)),
      )
      if (!blocked) return await fn()
      if (Date.now() >= deadline) throw new Error('Timed out waiting for another skill update')
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
    }
  } finally {
    await rm(claimDirectory, { recursive: true, force: true })
  }
}

async function liveClaims(root: string, staleAfterMs: number): Promise<Claim[]> {
  const directories = (await readdir(root, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, entry.name))
  const claims = await Promise.all(
    directories.map(async (directory): Promise<Claim | null> => {
      try {
        const owner = JSON.parse(await readFile(join(directory, 'owner.json'), 'utf8')) as {
          pid?: unknown
        }
        if (typeof owner.pid !== 'number') return await discardIfStale(directory, staleAfterMs)
        if (!isPidAlive(owner.pid)) {
          await rm(directory, { recursive: true, force: true })
          return null
        }
        const choosing = await lstat(join(directory, 'choosing'))
          .then(() => true)
          .catch(() => false)
        const ticket = await readFile(join(directory, 'ticket'), 'utf8')
          .then((value) => {
            const parsed = Number(value)
            return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
          })
          .catch(() => null)
        return { directory, pid: owner.pid, ticket, choosing }
      } catch {
        return await discardIfStale(directory, staleAfterMs)
      }
    }),
  )
  return claims.filter((claim): claim is Claim => claim !== null)
}

async function discardIfStale(directory: string, staleAfterMs: number): Promise<null> {
  try {
    if (Date.now() - (await stat(directory)).mtimeMs > staleAfterMs) {
      await rm(directory, { recursive: true, force: true })
    }
  } catch {
    // A concurrently released unique claim is already gone.
  }
  return null
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as { code?: string }).code === 'EPERM'
  }
}
