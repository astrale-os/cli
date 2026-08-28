#!/usr/bin/env bun

declare const __ASTRALE_BUNDLED__: true | undefined

export {}

// Source checkouts do not version the generated archive. Ensure it exists before
// loading any CLI module that imports embedded Skills, Studio, or Viewer assets.
// Bundled development artifacts and standalone releases define this constant
// after generating the archive during their build, so they skip this source-only path.
if (typeof __ASTRALE_BUNDLED__ === 'undefined') {
  const { buildEmbeddedAssets } = await import('../scripts/build-embedded-assets')
  await buildEmbeddedAssets({ quiet: true })
}

await import('./run')
