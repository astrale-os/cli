import { spawn, type ChildProcess, type StdioOptions } from 'node:child_process'

export type RunResult = {
  /** Exit code, or -1 when the process was killed by a signal. */
  code: number
  stdout: string
  stderr: string
}

/**
 * Spawn a child process and capture stdout/stderr as UTF-8 text.
 *
 * Uses `node:child_process` rather than `Bun.spawn` so the exact same code runs
 * under both the Bun-compiled standalone binary (Linux/macOS) and the Node/npm
 * build (Windows and any Node user). The promise rejects only when the process
 * fails to spawn (e.g. ENOENT); a non-zero exit resolves with that `code` so
 * callers can branch on it.
 */
export function run(
  file: string,
  args: string[] = [],
  opts: { cwd?: string } = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: opts.cwd,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }))
  })
}

/**
 * Spawn a child process with inherited stdio so its output streams live to the
 * user's terminal. Used for hand-held installs (npm / npx) where progress
 * matters and the output is for the human, not for parsing. Resolves with the
 * exit code; rejects only when the process fails to spawn (e.g. ENOENT).
 */
export function runInherit(
  file: string,
  args: string[] = [],
  opts: { cwd?: string } = {},
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd: opts.cwd, shell: false, stdio: 'inherit' })
    child.on('error', reject)
    child.on('close', (code) => resolve(code ?? -1))
  })
}

/**
 * Spawn a LONG-LIVED child and return the handle immediately so the caller can
 * supervise it (wait for exit, forward signals, tear down siblings). Unlike
 * run()/runInherit() — which resolve only once the child closes — this is for
 * servers the command keeps attached to (e.g. `astrale studio`'s Bun server and
 * Vite dev process). Same node:child_process basis (cross-runtime) and bare
 * PATH-name lookup convention. Default stdio streams stdout/stderr live but
 * ignores stdin, so two supervised children never contend for the TTY.
 */
export function spawnHandle(
  file: string,
  args: string[] = [],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; stdio?: StdioOptions; detached?: boolean } = {},
): ChildProcess {
  return spawn(file, args, {
    cwd: opts.cwd,
    env: opts.env,
    shell: false,
    // `detached` makes the child its own process-group leader so the caller can
    // tear down the whole tree (the child AND its grandchildren) with a single
    // group signal — `process.kill(-child.pid, …)`.
    detached: opts.detached,
    stdio: opts.stdio ?? ['ignore', 'inherit', 'inherit'],
  })
}
