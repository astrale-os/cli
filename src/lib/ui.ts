import type { Subprocess } from 'bun'

import type { AstraleConfig } from './config'

let uiProcess: Subprocess | null = null

/**
 * Start the Vite dev server for the playground UI — **only used in dev mode**.
 *
 * In normal operation the UI is served by the manager HTTP server itself
 * (see `ui-host.ts` / `nodeWithUi`). `startUIDev` spawns a Vite dev server
 * with HMR so UI contributors can iterate on `cli/playground/` against the
 * running manager.
 */
export function startUIDev(config: AstraleConfig): Subprocess {
  uiProcess = Bun.spawn(
    ['pnpm', '--filter', '@astrale-os/astrale-playground', 'dev', '--port', String(config.uiPort)],
    {
      stdout: 'inherit',
      stderr: 'inherit',
      env: {
        ...process.env,
        MANAGER_PORT: String(config.managerPort),
      },
    },
  )
  return uiProcess
}

export function stopUI(): void {
  if (uiProcess) {
    uiProcess.kill()
    uiProcess = null
  }
}
