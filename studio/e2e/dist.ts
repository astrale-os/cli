/**
 * Where one browser run's client build lives.
 *
 * Each run builds into its own folder, named by its port, so the server it starts never serves
 * a build that `pnpm build` or another run is rewriting underneath it.
 */
import { join, resolve } from 'node:path'

export const studioRoot = resolve(import.meta.dir, '..')
export const e2ePort = process.env.STUDIO_E2E_PORT ?? '4397'
export const e2eDist = join(studioRoot, 'client', 'dist-e2e', e2ePort)
