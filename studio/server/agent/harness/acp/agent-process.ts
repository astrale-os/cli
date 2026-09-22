/**
 * agent-process.ts — the ACP agent server as a child process.
 *
 * A turn, a side question and a probe each spawn their own agent server and speak
 * ACP over its stdio. They differ in how long they wait and what they report, but
 * not in how the process is started, watched, spoken to and put down: that is here.
 */
import * as acp from '@agentclientprotocol/sdk'
import { spawn } from 'node:child_process'
import { Readable, Writable } from 'node:stream'

import type { AcpProvider } from './command'

import { childEnvironment, terminateProcessTree } from '../process'

const MAX_STDERR = 16_000

export interface ProcessExit {
  code: number | null
  signal: NodeJS.Signals | null
  spawnError?: string
}

export interface AcpAgentProcess {
  child: ReturnType<typeof spawn>
  /** settles once, with whichever of `error` / `close` the process reports first */
  exit: Promise<ProcessExit>
  readonly exited: boolean
  /** the tail of what the agent wrote to stderr */
  readonly stderr: string
  /** the error a pending request fails with once the process is gone */
  failure(exit: ProcessExit, stderrSuffix: (stderr: string) => string): Error
  /** the agent's stdio as an ACP ndjson stream */
  stream(): ReturnType<typeof acp.ndJsonStream>
  /** end stdin, then escalate SIGTERM → SIGKILL on the process group while it lingers */
  shutdown(graceMs: number, terminateGraceMs: number, killGraceMs?: number): Promise<void>
}

/** Spawn the agent server in its own process group. Throws when `spawn` itself does. */
export function spawnAcpAgent(
  provider: AcpProvider,
  command: string[],
  cwd: string,
  env: Record<string, string>,
): AcpAgentProcess {
  const child = spawn(command[0], command.slice(1), {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: childEnvironment(env),
    detached: process.platform !== 'win32',
  })

  let stderr = ''
  let exited = false
  let resolveExit!: (exit: ProcessExit) => void
  const exit = new Promise<ProcessExit>((resolve) => {
    resolveExit = resolve
  })
  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', (chunk: string) => {
    stderr = (stderr + chunk).slice(-MAX_STDERR)
  })
  child.once('error', (error) => {
    if (exited) return
    exited = true
    resolveExit({ code: null, signal: null, spawnError: error.message })
  })
  child.once('close', (code, signal) => {
    if (exited) return
    exited = true
    resolveExit({ code, signal })
  })

  const exitWithin = (ms: number) =>
    Promise.race([exit.then(() => undefined), new Promise((resolve) => setTimeout(resolve, ms))])

  return {
    child,
    exit,
    get exited() {
      return exited
    },
    get stderr() {
      return stderr
    },
    failure: (result, stderrSuffix) =>
      new Error(
        result.spawnError
          ? `failed to spawn ${provider} ACP agent: ${result.spawnError}`
          : `${provider} ACP agent exited ${result.code ?? result.signal ?? -1}${stderrSuffix(stderr)}`,
      ),
    stream: () =>
      acp.ndJsonStream(
        Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>,
        Readable.toWeb(child.stdout!) as unknown as ReadableStream<Uint8Array>,
      ),
    async shutdown(graceMs, terminateGraceMs, killGraceMs = 0) {
      try {
        child.stdin?.end()
      } catch {
        /* already closed */
      }
      if (exited) return
      await exitWithin(graceMs)
      if (exited) return
      terminateProcessTree(child)
      await exitWithin(terminateGraceMs)
      if (exited) return
      terminateProcessTree(child, 'SIGKILL')
      if (killGraceMs > 0) await exitWithin(killGraceMs)
    },
  }
}

/** `initialize`, refusing an agent that negotiated a protocol this client does not speak. */
export async function initializeAgent(
  context: acp.ClientContext,
  provider: AcpProvider,
  clientInfo: { name: string; title: string },
  guard: (
    request: Promise<acp.InitializeResponse>,
    label: string,
  ) => Promise<acp.InitializeResponse>,
): Promise<acp.InitializeResponse> {
  const initialized = await guard(
    context.request(acp.methods.agent.initialize, {
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: { session: { configOptions: { boolean: {} } } },
      clientInfo,
    }) as Promise<acp.InitializeResponse>,
    'initialize',
  )
  if (initialized.protocolVersion !== acp.PROTOCOL_VERSION)
    throw new Error(
      `${provider} ACP negotiated unsupported protocol version ${initialized.protocolVersion}`,
    )
  return initialized
}
