#!/usr/bin/env bun
import { copyFile, readdir, rm } from 'node:fs/promises'

export async function buildViewer(): Promise<void> {
  const viewerDir = new URL('../viewer', import.meta.url).pathname
  const outdir = `${viewerDir}/dist`
  await rm(outdir, { recursive: true, force: true })
  const result = await Bun.build({
    entrypoints: [`${viewerDir}/main.ts`],
    outdir,
    target: 'browser',
    format: 'esm',
    minify: true,
  })
  if (!result.success) {
    for (const message of result.logs) console.error(message)
    throw new Error('viewer build failed')
  }
  await copyFile(`${viewerDir}/index.html`, `${outdir}/index.html`)
  const files = (await readdir(outdir)).sort()
  if (files.join('\n') !== 'index.html\nmain.js') {
    throw new Error(`viewer build emitted an unsupported asset set: ${files.join(', ')}`)
  }
  console.log('built viewer/dist')
}

if (import.meta.main) await buildViewer()
