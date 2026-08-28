#!/usr/bin/env bun

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { buildViewer } from './build-viewer'
import {
  embeddedAssetCacheIsCurrent,
  embeddedAssetInputDigest,
  withEmbeddedAssetLock,
  writeEmbeddedAssetCache,
} from './embedded-assets-cache'

type BuildEmbeddedAssetsOptions = {
  force?: boolean
  quiet?: boolean
}

export async function buildEmbeddedAssets(
  options: BuildEmbeddedAssetsOptions = {},
): Promise<'built' | 'current'> {
  const root = fileURLToPath(new URL('../', import.meta.url))
  const expectedBun = (await readFile(new URL('../.bun-version', import.meta.url), 'utf8')).trim()
  if (Bun.version !== expectedBun) {
    throw new Error(
      `embedded assets require Bun ${expectedBun}; received ${Bun.version} (install the version pinned by .bun-version)`,
    )
  }

  return withEmbeddedAssetLock(root, async () => {
    const inputDigest = await embeddedAssetInputDigest(root)
    if (!options.force && (await embeddedAssetCacheIsCurrent(root, inputDigest))) {
      if (!options.quiet) console.log(`embedded assets current (${inputDigest.slice(0, 12)})`)
      return 'current'
    }

    await buildViewer({ quiet: options.quiet })

    const studioDir = fileURLToPath(new URL('../studio/', import.meta.url))
    if (!existsSync(`${studioDir}/vite.config.ts`)) {
      throw new Error('studio source is missing its Vite configuration')
    }

    const viteBin = [
      `${studioDir}/node_modules/.bin/vite`,
      `${studioDir}/../node_modules/.bin/vite`,
    ].find(existsSync)
    if (!viteBin) {
      throw new Error('studio is present but Vite is not installed (run `pnpm install`)')
    }

    if (!options.quiet) console.log('building studio client (vite build)…')
    const studio = Bun.spawnSync([viteBin, 'build'], {
      cwd: studioDir,
      stdout: options.quiet ? 'ignore' : 'inherit',
      stderr: 'inherit',
    })
    if (studio.exitCode !== 0) throw new Error('studio client build failed')
    if (!options.quiet) console.log('built studio/client/dist')

    const generator = fileURLToPath(new URL('./generate-embedded-assets.ts', import.meta.url))
    const generated = Bun.spawnSync([process.execPath, generator], {
      stdout: options.quiet ? 'ignore' : 'inherit',
      stderr: 'inherit',
    })
    if (generated.exitCode !== 0) throw new Error('embedded asset generation failed')
    await writeEmbeddedAssetCache(root, inputDigest)
    return 'built'
  })
}

if (import.meta.main) await buildEmbeddedAssets({ force: process.argv.includes('--force') })
