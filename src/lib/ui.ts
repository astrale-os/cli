import type { Subprocess } from 'bun'

import type { AstraleConfig } from './config'

let uiProcess: Subprocess | null = null

/**
 * Start the backoffice playground-v2 dev server.
 * Spawns `pnpm --filter @astrale-os/kernel-playground dev --port <uiPort>`
 * with MANAGER_PORT set so the vite proxy targets the right kernel.
 */
export function startUI(config: AstraleConfig): Subprocess {
  uiProcess = Bun.spawn(
    ['pnpm', '--filter', '@astrale-os/kernel-playground', 'dev', '--port', String(config.uiPort)],
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
