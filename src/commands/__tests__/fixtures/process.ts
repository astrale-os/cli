import { afterEach, beforeEach } from 'bun:test'
import { createServer } from 'node:net'
import { stripVTControlCharacters } from 'node:util'

/** `process.exit` made observable: a command that exits throws this instead. */
export class ExitError extends Error {
  constructor(readonly code: number | string | null | undefined) {
    super(`process.exit(${String(code)})`)
  }
}

export interface CapturedProcess {
  stdout: string
  stderr: string
  /** The last stderr line as JSON: the structured failure a machine run ends on. */
  failure(): Record<string, unknown> & { readonly details?: any; readonly reason?: any }
}

/**
 * Capture stdout, stderr and `process.exit` for every test of the calling file. Each test starts
 * with empty buffers; the originals are restored after it.
 */
export function captureProcess(): CapturedProcess {
  const captured: CapturedProcess = {
    stdout: '',
    stderr: '',
    failure: () => JSON.parse(captured.stderr.trim().split('\n').at(-1)!),
  }
  const original = {
    exit: process.exit,
    stdout: process.stdout.write,
    stderr: process.stderr.write,
  }
  const text = (chunk: string | Uint8Array) =>
    typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
  beforeEach(() => {
    captured.stdout = ''
    captured.stderr = ''
    process.exit = ((code?: number | string | null) => {
      throw new ExitError(code)
    }) as typeof process.exit
    process.stdout.write = ((chunk: string | Uint8Array) => {
      captured.stdout += text(chunk)
      return true
    }) as typeof process.stdout.write
    process.stderr.write = ((chunk: string | Uint8Array) => {
      captured.stderr += text(chunk)
      return true
    }) as typeof process.stderr.write
  })
  afterEach(() => {
    process.exit = original.exit
    process.stdout.write = original.stdout
    process.stderr.write = original.stderr
  })
  return captured
}

/** Run `action` for a human: a terminal on stdout, console lines captured without color. */
export async function human(
  action: () => Promise<unknown>,
): Promise<{ readonly lines: string; readonly warnings: string; readonly all: string }> {
  const lines: string[] = []
  const warnings: string[] = []
  const original = { log: console.log, error: console.error, tty: process.stdout.isTTY }
  console.log = (...args: unknown[]) => void lines.push(args.map(String).join(' '))
  console.error = (...args: unknown[]) => void warnings.push(args.map(String).join(' '))
  process.stdout.isTTY = true
  try {
    await action()
  } finally {
    console.log = original.log
    console.error = original.error
    process.stdout.isTTY = original.tty
  }
  const shown = {
    lines: stripVTControlCharacters(lines.join('\n')),
    warnings: stripVTControlCharacters(warnings.join('\n')),
  }
  return { ...shown, all: `${shown.lines}\n${shown.warnings}` }
}

const ENTRY = new URL('../../../../bin/astrale.ts', import.meta.url).pathname

/** Run the real CLI in a separate process against the CLI home `home`. */
export async function runCli(
  home: string,
  args: readonly string[],
  options: { readonly env?: Record<string, string>; readonly stdin?: Blob } = {},
): Promise<{ readonly exitCode: number; readonly stdout: string; readonly stderr: string }> {
  const child = Bun.spawn(['bun', ENTRY, ...args], {
    env: { ...process.env, ASTRALE_HOME: home, NO_UPDATE_NOTIFIER: '1', ...options.env },
    stdin: options.stdin ?? 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  return { exitCode, stdout, stderr }
}

/** A loopback TCP port that counts every connection made to it. */
export async function observeConnections() {
  let connections = 0
  const server = createServer((socket) => {
    connections += 1
    socket.destroy()
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected an observing TCP port')
  return {
    url: `http://127.0.0.1:${address.port}`,
    count: () => connections,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}
