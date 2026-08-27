import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { gunzipSync } from 'node:zlib'

import {
  EMBEDDED_ASSET_ARCHIVE_BASE64,
  EMBEDDED_ASSET_DIGEST,
  EMBEDDED_ASSET_FORMAT,
  EMBEDDED_ASSET_VERSION,
} from '../generated/embedded-assets'
import { withFileLock } from '../state/files'

type EmbeddedFile = { path: string; mode: number; contents: string }
type EmbeddedArchive = { format: number; version: string; files: EmbeddedFile[] }

let decoded: EmbeddedArchive | undefined

function archive(): EmbeddedArchive {
  if (decoded) return decoded
  const parsed = JSON.parse(
    gunzipSync(Buffer.from(EMBEDDED_ASSET_ARCHIVE_BASE64, 'base64')).toString('utf8'),
  ) as EmbeddedArchive
  if (parsed.format !== EMBEDDED_ASSET_FORMAT || parsed.version !== EMBEDDED_ASSET_VERSION) {
    throw new Error('embedded Astrale asset archive is incompatible with this binary')
  }
  decoded = parsed
  return parsed
}

export function embeddedFiles(prefix: 'skills' | 'studio' | 'viewer'): EmbeddedFile[] {
  const marker = `${prefix}/`
  return archive().files.filter((file) => file.path.startsWith(marker))
}

export function embeddedAssetDir(
  group: 'studio' | 'viewer',
  root = process.env.ASTRALE_HOME ?? join(homedir(), '.astrale'),
): string {
  return join(
    root,
    'cache',
    'embedded',
    `${EMBEDDED_ASSET_VERSION}-${EMBEDDED_ASSET_DIGEST.slice(0, 12)}`,
    group,
  )
}

export async function materializeEmbeddedAssets(
  group: 'studio' | 'viewer',
  root = process.env.ASTRALE_HOME ?? join(homedir(), '.astrale'),
): Promise<string> {
  const destination = embeddedAssetDir(group, root)
  const marker = join(destination, '.complete')
  try {
    if ((await readFile(marker, 'utf8')).trim() === EMBEDDED_ASSET_DIGEST) return destination
  } catch {
    // A missing/incomplete cache is rebuilt atomically below.
  }

  return withFileLock(join(root, 'locks', 'embedded-assets.lock'), async () => {
    try {
      if ((await readFile(marker, 'utf8')).trim() === EMBEDDED_ASSET_DIGEST) return destination
    } catch {
      // Continue with a fresh materialization while holding the process lock.
    }

    const staged = `${destination}.next-${process.pid}`
    await rm(staged, { recursive: true, force: true })
    await mkdir(staged, { recursive: true })
    for (const file of embeddedFiles(group)) {
      const relative = file.path.slice(group.length + 1)
      if (!relative || relative.split('/').some((part) => part === '..' || part === '')) {
        throw new Error(`unsafe embedded asset path: ${file.path}`)
      }
      const target = join(staged, relative)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, Buffer.from(file.contents, 'base64'))
      await chmod(target, file.mode)
    }
    await writeFile(join(staged, '.complete'), `${EMBEDDED_ASSET_DIGEST}\n`)
    await mkdir(dirname(destination), { recursive: true })
    await rm(destination, { recursive: true, force: true })
    await rename(staged, destination)
    return destination
  })
}
