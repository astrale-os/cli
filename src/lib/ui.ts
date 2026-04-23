import { openSync } from 'node:fs'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { log } from './log'
import { LOGS_DIR, UI_PID_PATH } from './paths'

/**
 * UI (playground + gui) lifecycle on the host — the CLI spawns each vite
 * dev server as a detached background process, records their PIDs in
 * `~/.astrale/ui.pids.json`, and `astrale stop` reads the file to kill them.
 */

export interface UiPids {
  readonly playground: number
  readonly gui: number
}

function workspaceRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  // `cli/src/lib/ui.ts` → `cli/src/lib` → `cli/src` → `cli` → `workspace`
  return resolve(here, '..', '..', '..')
}

/** Spawn the two vite dev servers detached, return their PIDs. */
export async function spawnUis(): Promise<UiPids> {
  const workspace = workspaceRoot()
  await mkdir(LOGS_DIR, { recursive: true })

  const playgroundOut = openSync(join(LOGS_DIR, 'playground.stdout.log'), 'a')
  const playgroundErr = openSync(join(LOGS_DIR, 'playground.stderr.log'), 'a')
  const guiOut = openSync(join(LOGS_DIR, 'gui.stdout.log'), 'a')
  const guiErr = openSync(join(LOGS_DIR, 'gui.stderr.log'), 'a')

  const playgroundProc = Bun.spawn(['pnpm', '--filter', '@astrale-os/astrale-playground', 'dev'], {
    cwd: workspace,
    stdout: playgroundOut,
    stderr: playgroundErr,
    stdin: 'ignore',
  })
  playgroundProc.unref()

  const guiProc = Bun.spawn(['pnpm', '--filter', '@astrale-os/astrale-gui', 'dev'], {
    cwd: workspace,
    stdout: guiOut,
    stderr: guiErr,
    stdin: 'ignore',
  })
  guiProc.unref()

  const pids: UiPids = { playground: playgroundProc.pid, gui: guiProc.pid }
  await writeFile(UI_PID_PATH, JSON.stringify(pids, null, 2))
  return pids
}

/**
 * Kill any UI processes recorded in the PID file. Silent by default.
 * Returns true if at least one process was actually killed.
 */
export async function stopUis(opts: { silent?: boolean } = {}): Promise<boolean> {
  let raw: string
  try {
    raw = await readFile(UI_PID_PATH, 'utf-8')
  } catch {
    return false
  }

  let pids: Partial<UiPids> = {}
  try {
    pids = JSON.parse(raw) as Partial<UiPids>
  } catch {
    await unlink(UI_PID_PATH).catch(() => {})
    return false
  }

  let killed = false
  for (const [name, pid] of Object.entries(pids)) {
    if (typeof pid !== 'number') continue
    try {
      process.kill(pid, 'SIGTERM')
      killed = true
      if (!opts.silent) log.success(`UI stopped: ${name} (PID ${pid})`)
    } catch (e: unknown) {
      if (e instanceof Error && 'code' in e && e.code === 'ESRCH') {
        if (!opts.silent) log.dim(`UI ${name} was not running (stale PID ${pid})`)
      } else if (!opts.silent) {
        log.warn(`Failed to stop UI ${name} (PID ${pid}): ${String(e)}`)
      }
    }
  }

  await unlink(UI_PID_PATH).catch(() => {})
  return killed
}
