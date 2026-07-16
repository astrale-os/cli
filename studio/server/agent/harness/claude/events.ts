import { spawn } from 'node:child_process'

import type { AgentTurnInput, AgentTurnResult } from '../adapter'

import { childEnvironment, terminateProcessTree } from '../process'
import { buildClaudeTurnArgs } from './command'
import { writeClaudeMcpConfig } from './mcp'

const RESUME_REJECTED =
  /no conversation found|session (?:id .*)?(?:not found|does not exist|no longer exists|expired)|could not (?:find|load|resume) .*session|unknown session|invalid session id/i

function toolTarget(name: string, input: Record<string, unknown> | undefined): string {
  if (!input) return ''
  const text = (value: unknown) =>
    typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value)
  switch (name) {
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
    case 'NotebookEdit':
      return text(input.file_path ?? input.path ?? input.notebook_path)
    case 'Read':
      return text(input.file_path)
    case 'Bash':
      return text(input.command).slice(0, 200)
    case 'Grep':
    case 'Glob':
      return text(input.pattern)
    case 'Task':
      return text(input.description)
    default:
      return text(Object.values(input)[0]).slice(0, 200)
  }
}

/** Execute one Claude stream-json turn and normalize its result. */
export function runClaudeTurn(bin: string, input: AgentTurnInput): Promise<AgentTurnResult> {
  const mcp = writeClaudeMcpConfig(input.root, input.mcpServers)
  return new Promise((resolve) => {
    let resolvedSession = input.sessionId
    let finalText = ''
    let costUsd: number | undefined
    let numTurns: number | undefined
    let tokens: number | undefined
    let isError = false
    let errorMessage: string | undefined
    let sawResult = false
    let stderr = ''
    let settled = false
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined
    let onAbort = () => {}
    const finish = (result: AgentTurnResult) => {
      if (settled) return
      settled = true
      if (forceKillTimer) clearTimeout(forceKillTimer)
      input.signal.removeEventListener('abort', onAbort)
      mcp.dispose()
      resolve(result)
    }

    let child: ReturnType<typeof spawn>
    try {
      child = spawn(bin, buildClaudeTurnArgs(input, mcp.path), {
        cwd: input.root,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: childEnvironment(input.env),
        detached: process.platform !== 'win32',
      })
    } catch (error) {
      finish({
        sessionId: resolvedSession,
        finalText,
        isError: true,
        errorMessage: `failed to spawn ${bin}: ${String(error)}`,
      })
      return
    }

    onAbort = () => {
      terminateProcessTree(child)
      forceKillTimer = setTimeout(() => terminateProcessTree(child, 'SIGKILL'), 2_000)
      forceKillTimer.unref?.()
    }
    if (input.signal.aborted) onAbort()
    else input.signal.addEventListener('abort', onAbort, { once: true })

    child.stdin?.write(input.prompt)
    child.stdin?.end()

    const handleLine = (line: string) => {
      let event: any
      try {
        event = JSON.parse(line)
      } catch {
        return
      }
      switch (event.type) {
        case 'system':
          if (event.subtype === 'init') {
            if (event.session_id) resolvedSession = event.session_id
            input.onEvent({ kind: 'status', text: 'session started' })
          }
          return
        case 'assistant':
          if (!Array.isArray(event.message?.content)) return
          for (const block of event.message.content) {
            if (block.type === 'text' && block.text?.trim())
              input.onEvent({ kind: 'message', text: block.text.trim() })
            else if (block.type === 'thinking' && block.thinking?.trim())
              input.onEvent({ kind: 'thinking', text: block.thinking.trim() })
            else if (block.type === 'tool_use')
              input.onEvent({
                kind: 'tool',
                text: block.name,
                tool: block.name,
                target: toolTarget(block.name, block.input),
              })
          }
          return
        case 'result': {
          sawResult = true
          if (typeof event.result === 'string') finalText = event.result
          if (typeof event.total_cost_usd === 'number') costUsd = event.total_cost_usd
          if (typeof event.num_turns === 'number') numTurns = event.num_turns
          if (event.usage && typeof event.usage === 'object') {
            const usage = event.usage as Record<string, number | undefined>
            tokens =
              (usage.input_tokens ?? 0) +
              (usage.output_tokens ?? 0) +
              (usage.cache_read_input_tokens ?? 0) +
              (usage.cache_creation_input_tokens ?? 0)
          }
          if (event.session_id) resolvedSession = event.session_id
          if (
            event.is_error ||
            event.subtype === 'error_during_execution' ||
            event.subtype === 'error_max_turns'
          ) {
            isError = true
            errorMessage = event.subtype || 'agent error'
          }
          return
        }
        case 'rate_limit_event':
          if (event.rate_limit_info?.status && event.rate_limit_info.status !== 'allowed')
            input.onEvent({
              kind: 'status',
              text: `rate limit: ${event.rate_limit_info.status}`,
            })
      }
    }

    let buffer = ''
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      buffer += chunk
      let newline: number
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (line) handleLine(line)
      }
    })
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.on('error', (error) =>
      finish({
        sessionId: resolvedSession,
        finalText,
        costUsd,
        numTurns,
        tokens,
        isError: true,
        errorMessage: `failed to spawn ${bin}: ${error.message}`,
      }),
    )
    child.on('close', (code) => {
      const trailing = buffer.trim()
      if (trailing) handleLine(trailing)
      if (input.signal.aborted)
        return finish({
          sessionId: resolvedSession,
          finalText,
          costUsd,
          numTurns,
          tokens,
          isError: true,
          errorMessage: 'canceled',
        })
      if (code !== 0) {
        isError = true
        errorMessage =
          errorMessage || `claude exited ${code}${stderr ? `: ${stderr.slice(-400)}` : ''}`
      } else if (!sawResult) {
        isError = true
        errorMessage = 'claude exited without a result event'
      }
      finish({
        sessionId: resolvedSession,
        finalText,
        costUsd,
        numTurns,
        tokens,
        isError,
        errorMessage,
        resumeRejected:
          !!input.sessionId &&
          (isError || code !== 0) &&
          RESUME_REJECTED.test(`${errorMessage ?? ''}\n${stderr}`),
      })
    })
  })
}
