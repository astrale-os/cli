#!/usr/bin/env bun

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { buildViewer } from './build-viewer'

export async function buildEmbeddedAssets(): Promise<void> {
  const expectedBun = (await readFile(new URL('../.bun-version', import.meta.url), 'utf8')).trim()
  if (Bun.version !== expectedBun) {
    throw new Error(
      `embedded assets require Bun ${expectedBun}; received ${Bun.version} (install the version pinned by .bun-version)`,
    )
  }

  await buildViewer()

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

  console.log('building studio client (vite build)…')
  const studio = Bun.spawnSync([viteBin, 'build'], {
    cwd: studioDir,
    stdout: 'inherit',
    stderr: 'inherit',
  })
  if (studio.exitCode !== 0) throw new Error('studio client build failed')
  console.log('built studio/client/dist')

  const generator = fileURLToPath(new URL('./generate-embedded-assets.ts', import.meta.url))
  const generated = Bun.spawnSync([process.execPath, generator], {
    stdout: 'inherit',
    stderr: 'inherit',
  })
  if (generated.exitCode !== 0) throw new Error('embedded asset generation failed')
}

if (import.meta.main) await buildEmbeddedAssets()
