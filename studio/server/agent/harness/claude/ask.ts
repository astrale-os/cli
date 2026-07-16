import { spawn } from 'node:child_process'

import type { AskInput, AskResult } from '../adapter'

import { childEnvironment, terminateProcessTree } from '../process'
import { buildClaudeAskArgs } from './command'

/** Execute one ephemeral Claude side-question stream. */
export function runClaudeAsk(bin: string, input: AskInput): Promise<AskResult> {
  return new Promise((resolve) => {
    let finalText = ''
    let stderr = ''
    let isError = false
    let errorMessage: string | undefined
    let sawResult = false
    let settled = false
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined
    let onAbort = () => {}
    const finish = (result: AskResult) => {
      if (settled) return
      settled = true
      if (forceKillTimer) clearTimeout(forceKillTimer)
      input.signal.removeEventListener('abort', onAbort)
      resolve(result)
    }

    let child: ReturnType<typeof spawn>
    try {
      child = spawn(bin, buildClaudeAskArgs(input), {
        cwd: input.root,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: childEnvironment(input.env),
        detached: process.platform !== 'win32',
      })
    } catch (error) {
      finish({
        text: finalText,
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
      if (event.type === 'assistant' && Array.isArray(event.message?.content)) {
        for (const block of event.message.content)
          if (block.type === 'text' && block.text) input.onDelta(block.text)
      } else if (event.type === 'result') {
        sawResult = true
        if (typeof event.result === 'string') finalText = event.result
        if (
          event.is_error ||
          event.subtype === 'error_during_execution' ||
          event.subtype === 'error_max_turns'
        ) {
          isError = true
          errorMessage = event.subtype || 'ask error'
        }
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
        text: finalText,
        isError: true,
        errorMessage: `failed to spawn ${bin}: ${error.message}`,
      }),
    )
    child.on('close', (code) => {
      const trailing = buffer.trim()
      if (trailing) handleLine(trailing)
      if (input.signal.aborted)
        return finish({ text: finalText, isError: true, errorMessage: 'canceled' })
      if (code !== 0) {
        isError = true
        errorMessage =
          errorMessage || `claude exited ${code}${stderr ? `: ${stderr.slice(-300)}` : ''}`
      } else if (!sawResult) {
        isError = true
        errorMessage = 'claude exited without a result event'
      }
      finish({ text: finalText, isError, errorMessage })
    })
  })
}
