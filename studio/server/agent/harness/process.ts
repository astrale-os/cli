import { spawn } from 'node:child_process'

export interface CapturedCommand {
  code: number
  stdout: string
  stderr: string
  aborted?: boolean
  timedOut?: boolean
}

export interface CaptureOptions {
  env?: Record<string, string>
  signal?: AbortSignal
  timeoutMs?: number
}

/** Merge overrides into the spawned harness only. */
export function childEnvironment(extra?: Record<string, string>): NodeJS.ProcessEnv | undefined {
  return extra && Object.keys(extra).length ? { ...process.env, ...extra } : undefined
}

/** Capture a short-lived local command such as gateway-token minting. */
export function captureCommand(
  bin: string,
  args: string[],
  cwd: string,
  options: CaptureOptions = {},
): Promise<CapturedCommand> {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let onAbort = () => {}
    const finish = (result: CapturedCommand) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      resolve(result)
    }
    if (options.signal?.aborted) {
      finish({ code: -1, stdout, stderr: 'canceled', aborted: true })
      return
    }
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(bin, args, {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: childEnvironment(options.env),
        detached: process.platform !== 'win32',
      })
    } catch (error) {
      finish({ code: -1, stdout, stderr: String(error) })
      return
    }
    onAbort = () => {
      terminateProcessTree(child, 'SIGKILL')
      finish({ code: -1, stdout, stderr: 'canceled', aborted: true })
    }
    options.signal?.addEventListener('abort', onAbort, { once: true })
    const timeoutMs = options.timeoutMs ?? 15_000
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        terminateProcessTree(child, 'SIGKILL')
        finish({
          code: -1,
          stdout,
          stderr: `command timed out after ${timeoutMs}ms`,
          timedOut: true,
        })
      }, timeoutMs)
      timer.unref?.()
    }
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.on('error', (error) => finish({ code: -1, stdout, stderr: error.message }))
    child.on('close', (code) => finish({ code: code ?? -1, stdout, stderr }))
  })
}

/** Terminate the whole harness process group so child commands cannot leak. */
export function terminateProcessTree(
  child: ReturnType<typeof spawn>,
  signal: NodeJS.Signals = 'SIGTERM',
): void {
  try {
    if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal)
    else child.kill(signal)
  } catch {
    try {
      child.kill(signal)
    } catch {
      /* already gone */
    }
  }
}
