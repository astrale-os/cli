import { spawn } from 'node:child_process'

import type { AgentTurnInput, AgentTurnResult } from '../adapter'

import { childEnvironment, terminateProcessTree } from '../process'
import { buildCodexArgs } from './command'
import { handleCodexExecEvent, newCodexRunState, type CodexRunState } from './events'

const RESUME_REJECTED =
  /no rollout found for thread id|thread\/resume failed|thread (?:id )?.*(?:not found|does not exist|expired)|could not (?:find|load|resume) .*thread|unknown thread|invalid thread id/i

/** Execute one Codex JSONL turn and normalize its result. */
export function runCodexExec(
  bin: string,
  input: AgentTurnInput,
  ephemeral = false,
): Promise<AgentTurnResult> {
  return new Promise((resolve) => {
    const state = newCodexRunState(input.sessionId)
    let stderr = ''
    let settled = false
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined
    let onAbort = () => {}
    const finish = (result: AgentTurnResult) => {
      if (settled) return
      settled = true
      if (forceKillTimer) clearTimeout(forceKillTimer)
      input.signal.removeEventListener('abort', onAbort)
      resolve(result)
    }
    const resultFromState = (current: CodexRunState, errorMessage?: string): AgentTurnResult => ({
      sessionId: current.sessionId,
      finalText: current.finalText,
      tokens: current.tokens,
      numTurns: 1,
      isError: current.isError || !!errorMessage,
      errorMessage: errorMessage ?? current.errorMessage,
      resumeRejected:
        !!input.sessionId &&
        (current.isError || !!errorMessage) &&
        RESUME_REJECTED.test(`${errorMessage ?? current.errorMessage ?? ''}\n${stderr}`),
    })

    let child: ReturnType<typeof spawn>
    try {
      child = spawn(bin, buildCodexArgs(input, ephemeral), {
        cwd: input.root,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: childEnvironment(input.env),
        detached: process.platform !== 'win32',
      })
    } catch (error) {
      finish(resultFromState(state, `failed to spawn ${bin}: ${String(error)}`))
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

    let buffer = ''
    const handleLine = (line: string) => {
      let event: any
      try {
        event = JSON.parse(line)
      } catch {
        return
      }
      handleCodexExecEvent(event, state, input.onEvent)
    }
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
      finish(resultFromState(state, `failed to spawn ${bin}: ${error.message}`)),
    )
    child.on('close', (code) => {
      const trailing = buffer.trim()
      if (trailing) handleLine(trailing)
      if (input.signal.aborted)
        return finish({
          ...resultFromState(state, 'canceled'),
          isError: true,
          errorMessage: 'canceled',
        })
      const exitError =
        code !== 0
          ? state.errorMessage ||
            `codex exited ${code ?? -1}${stderr ? `: ${stderr.trim().slice(-500)}` : ''}`
          : !state.terminal && !state.isError
            ? 'codex exited without a terminal turn event'
            : undefined
      finish(resultFromState(state, exitError))
    })
  })
}
