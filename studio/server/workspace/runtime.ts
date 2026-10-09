import type { StudioRuntime } from '../../shared/types'

import pkg from '../../../package.json'
import { runStudioCliText, studioCliCommand } from '../cli'

// Captured in this process, never read from the mutable installation on disk.
const runningVersion = pkg.version
let launch: { target: string; port: number } | undefined

/** Preserve the original target (including a config file) and the actual listening port. */
export function initStudioRuntime(target: string, port: number): void {
  launch = { target, port }
}

/** The server and its delegated CLI can belong to different releases after an update. */
export async function getStudioRuntime(): Promise<StudioRuntime> {
  if (!launch) throw new Error('The Studio launch context is unavailable')
  const result = await runStudioCliText(['--version'], {
    timeoutMs: 5_000,
    env: { ASTRALE_TELEMETRY_NO_TRIGGER: '1' },
  })
  const installedVersion = result.stdout.trim()
  if (!result.ok || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(installedVersion)) {
    throw new Error(result.detail || 'The installed Astrale CLI version could not be read')
  }
  return {
    runningVersion,
    installedVersion,
    restartCommand: studioCliCommand([
      'studio',
      launch.target,
      '--port',
      String(launch.port),
      ...(process.env.DOMAIN_STUDIO_DEV === '1' ? ['--dev'] : []),
      ...(['claude', 'codex'].includes(process.env.DOMAIN_STUDIO_HARNESS ?? '')
        ? ['--harness', process.env.DOMAIN_STUDIO_HARNESS!]
        : []),
    ]),
  }
}
