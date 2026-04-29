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
 *
 * The recorded PID is the pnpm wrapper, which spawns a vite child. We spawn
 * with `detached: true` so the wrapper becomes its own session/process-group
 * leader; on stop we signal the negative PID (`-pgid`) to take down the whole
 * group in one shot. Without this, pnpm exits but vite is reparented to
 * launchd/init and survives — re-binding the same dev port forever.
 */

export interface UiPids {
  readonly playground: number
  readonly gui: number
}

/**
 * Ports the workspace's vite `dev` scripts hardcode (3200 playground, 3400
 * gui). Used as a defensive sweep target in `stopUis`, so zombies survive
 * neither pidfile teardown nor a CLI restart. Keep in sync with
 * `cli/playground/package.json` and `cli/gui/package.json`.
 */
const UI_DEV_PORTS = [3200, 3400] as const

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
    detached: true,
  })
  playgroundProc.unref()

  const guiProc = Bun.spawn(['pnpm', '--filter', '@astrale-os/astrale-gui', 'dev'], {
    cwd: workspace,
    stdout: guiOut,
    stderr: guiErr,
    stdin: 'ignore',
    detached: true,
  })
  guiProc.unref()

  const pids: UiPids = { playground: playgroundProc.pid, gui: guiProc.pid }
  await writeFile(UI_PID_PATH, JSON.stringify(pids, null, 2))
  return pids
}

/**
 * Kill any UI processes recorded in the PID file, then sweep the known
 * dev-script ports for zombies that survived pidfile teardown (e.g. processes
 * spawned by a pre-`detached` CLI version that got reparented to launchd).
 * Returns true if at least one process was killed.
 */
export async function stopUis(opts: { silent?: boolean } = {}): Promise<boolean> {
  let killed = false

  let raw: string | null = null
  try {
    raw = await readFile(UI_PID_PATH, 'utf-8')
  } catch {
    /* no pidfile — fall through to port sweep */
  }

  if (raw !== null) {
    let pids: Partial<UiPids> = {}
    try {
      pids = JSON.parse(raw) as Partial<UiPids>
    } catch {
      pids = {}
    }

    for (const [name, pid] of Object.entries(pids)) {
      if (typeof pid !== 'number') continue
      if (killProcessGroup(pid)) {
        killed = true
        if (!opts.silent) log.success(`UI stopped: ${name} (PID ${pid})`)
      } else if (!opts.silent) {
        log.dim(`UI ${name} was not running (stale PID ${pid})`)
      }
    }

    await unlink(UI_PID_PATH).catch(() => {})
  }

  // Defensive sweep: kill anything still listening on the dev-script ports.
  // This catches zombies whose PIDs aren't in the pidfile (older CLI versions,
  // crashed CLI runs, etc.).
  for (const port of UI_DEV_PORTS) {
    const orphans = await pidsListeningOn(port)
    for (const pid of orphans) {
      if (killProcessGroup(pid)) {
        killed = true
        if (!opts.silent) log.success(`UI stopped: orphan on :${port} (PID ${pid})`)
      }
    }
  }

  return killed
}

/**
 * Kill a process group by signalling `-pid` (negative PID = pgid on POSIX).
 * Falls back to killing just `pid` if the negative kill fails — covers the
 * legacy case where the recorded PID was not a process-group leader.
 */
function killProcessGroup(pid: number): boolean {
  try {
    process.kill(-pid, 'SIGTERM')
    return true
  } catch (e: unknown) {
    // ESRCH on a negative PID can mean "no such pgrp" OR "pid is not a pgrp
    // leader". Try the plain PID before giving up.
    if (e instanceof Error && 'code' in e && e.code === 'ESRCH') {
      try {
        process.kill(pid, 'SIGTERM')
        return true
      } catch {
        return false
      }
    }
    return false
  }
}

/** Find PIDs listening on a TCP port via `lsof`. Empty array on any failure. */
async function pidsListeningOn(port: number): Promise<number[]> {
  try {
    const proc = Bun.spawn(['lsof', '-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], {
      stdout: 'pipe',
      stderr: 'ignore',
      stdin: 'ignore',
    })
    const out = await new Response(proc.stdout).text()
    await proc.exited
    return [
      ...new Set(
        out
          .split('\n')
          .map((s) => Number(s.trim()))
          .filter((n) => Number.isFinite(n) && n > 0),
      ),
    ]
  } catch {
    return []
  }
}
