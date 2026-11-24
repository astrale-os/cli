#!/usr/bin/env bun
import { buildViewerBundle } from '../src/lib/view/viewer-bundle'

export async function buildViewer(options: { quiet?: boolean } = {}): Promise<void> {
  const source = new URL('../viewer', import.meta.url).pathname
  await buildViewerBundle({ source, outdir: `${source}/dist`, minify: true })
  if (!options.quiet) console.log('built viewer/dist')
}

if (import.meta.main) await buildViewer()
