import { spawn } from 'node:child_process'

import type { HarnessLoadout } from '../../../../shared/types'
import type {
  AgentHarness,
  AgentTurnInput,
  AgentTurnResult,
  AskInput,
  AskResult,
  HarnessHealth,
  HarnessLoadoutOptions,
} from '../adapter'

import { childEnvironment, terminateProcessTree } from '../process'
import { readSkillContent, scanClaudeSkills } from '../skills'
import { buildClaudeAskArgs } from './command'
import { runClaudeTurn } from './events'
import { loadClaudeConfiguration, probeClaudeHealth } from './loadout'

const DEFAULT_BIN = process.env.DOMAIN_STUDIO_CLAUDE_BIN || 'claude'

export class ClaudeCodeHarness implements AgentHarness {
  id = 'claude'
  label = 'Claude Code (local)'
  capabilities = {
    effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
    accessLevels: ['workspace', 'full'],
    ask: true,
    loadout: true,
    gateway: 'anthropic',
  } as const

  private availCache?: { at: number; health: HarnessHealth }
  private loadoutCache?: { at: number; key: string; data: HarnessLoadout }

  constructor(private readonly bin = DEFAULT_BIN) {}

  async health(signal?: AbortSignal): Promise<HarnessHealth> {
    const now = Date.now()
    if (this.availCache && now - this.availCache.at < 30_000) return this.availCache.health
    const health = await probeClaudeHealth(this.bin, signal)
    if (!signal?.aborted) this.availCache = { at: now, health }
    return health
  }

  async isAvailable(signal?: AbortSignal): Promise<boolean> {
    return (await this.health(signal)).ok
  }

  async loadout(root: string, options?: HarnessLoadoutOptions): Promise<HarnessLoadout> {
    const now = Date.now()
    const key = `${root}\u0000${options?.model ?? ''}\u0000${JSON.stringify(options?.env ?? {})}`
    if (this.loadoutCache && this.loadoutCache.key === key && now - this.loadoutCache.at < 60_000)
      return this.loadoutCache.data
    const data = await loadClaudeConfiguration(this.bin, root, options)
    this.loadoutCache = { at: now, key, data }
    return data
  }

  async skillContent(
    root: string,
    command: string,
  ): Promise<{ command: string; content: string; path: string } | null> {
    return readSkillContent(scanClaudeSkills(root), command)
  }

  run(input: AgentTurnInput): Promise<AgentTurnResult> {
    return runClaudeTurn(this.bin, input)
  }

  ask(input: AskInput): Promise<AskResult> {
    return new Promise((resolve) => {
      let finalText = ''
      let stderr = ''
      let isError = false
      let errorMessage: string | undefined
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
        child = spawn(this.bin, buildClaudeAskArgs(input), {
          cwd: input.root,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: childEnvironment(input.env),
          detached: process.platform !== 'win32',
        })
      } catch (error) {
        finish({
          text: finalText,
          isError: true,
          errorMessage: `failed to spawn ${this.bin}: ${String(error)}`,
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
          errorMessage: `failed to spawn ${this.bin}: ${error.message}`,
        }),
      )
      child.on('close', (code) => {
        const trailing = buffer.trim()
        if (trailing) handleLine(trailing)
        if (input.signal.aborted)
          return finish({ text: finalText, isError: true, errorMessage: 'canceled' })
        if (code !== 0 && !finalText) {
          isError = true
          errorMessage =
            errorMessage || `claude exited ${code}${stderr ? `: ${stderr.slice(-300)}` : ''}`
        }
        finish({ text: finalText, isError, errorMessage })
      })
    })
  }
}
