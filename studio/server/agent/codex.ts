import { spawn } from 'node:child_process'

import type { AgentAccess, AgentEffort, HarnessLoadout } from '../../shared/types'
import type {
  AgentHarness,
  AgentTurnInput,
  AgentTurnResult,
  AskInput,
  AskResult,
  HarnessHealth,
  HarnessLoadoutOptions,
} from './types'

import { runCodexForkAsk } from './codex-app-server'
import { handleCodexExecEvent, newCodexRunState, type CodexRunState } from './codex-events'
import { probeCodexModels } from './codex-models'
import { codexMcpConfigArgs, tomlString } from './mcp-config'
import { readSkillContent, scanCodexSkills, type CodexPlugin } from './skills'

const DEFAULT_BIN = process.env.DOMAIN_STUDIO_CODEX_BIN || 'codex'
const EXTRA_ARGS = (process.env.DOMAIN_STUDIO_CODEX_ARGS || '').split(' ').filter(Boolean)
const RESUME_REJECTED =
  /no rollout found for thread id|thread\/resume failed|thread (?:id )?.*(?:not found|does not exist|expired)|could not (?:find|load|resume) .*thread|unknown thread|invalid thread id/i

function childEnv(extra?: Record<string, string>): NodeJS.ProcessEnv | undefined {
  return extra && Object.keys(extra).length ? { ...process.env, ...extra } : undefined
}

function sandbox(access?: AgentAccess): 'workspace-write' | 'danger-full-access' {
  return access === 'workspace' ? 'workspace-write' : 'danger-full-access'
}

function normalizeEffort(effort?: AgentEffort): AgentEffort | undefined {
  if (effort === 'max') return 'xhigh'
  return effort
}

export function buildCodexArgs(
  input: Pick<
    AgentTurnInput,
    'appendSystemPrompt' | 'sessionId' | 'model' | 'effort' | 'access' | 'mcpServers'
  >,
  ephemeral = false,
): string[] {
  const args = ['exec']
  if (input.sessionId) args.push('resume', input.sessionId)
  args.push(
    '--json',
    '--skip-git-repo-check',
    '-c',
    'approval_policy="never"',
    '-c',
    `sandbox_mode=${tomlString(sandbox(input.access))}`,
  )
  const effort = normalizeEffort(input.effort)
  if (input.model) args.push('--model', input.model)
  if (effort) args.push('-c', `model_reasoning_effort=${tomlString(effort)}`)
  if (input.appendSystemPrompt)
    args.push('-c', `developer_instructions=${tomlString(input.appendSystemPrompt)}`)
  args.push(...codexMcpConfigArgs(input.mcpServers))
  if (ephemeral) args.push('--ephemeral')
  args.push(...EXTRA_ARGS, '-')
  return args
}

function terminate(child: ReturnType<typeof spawn>, signal: NodeJS.Signals = 'SIGTERM'): void {
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

function runExec(bin: string, input: AgentTurnInput, ephemeral = false): Promise<AgentTurnResult> {
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
        env: childEnv(input.env),
        detached: process.platform !== 'win32',
      })
    } catch (error) {
      finish(resultFromState(state, `failed to spawn ${bin}: ${String(error)}`))
      return
    }
    onAbort = () => {
      terminate(child)
      forceKillTimer = setTimeout(() => terminate(child, 'SIGKILL'), 2_000)
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
          : undefined
      finish(resultFromState(state, exitError))
    })
  })
}

function capture(
  bin: string,
  args: string[],
  cwd: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (result: { code: number; stdout: string; stderr: string }) => {
      if (settled) return
      settled = true
      resolve(result)
    }
    const child = spawn(bin, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
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

function parseJson<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T
  } catch {
    return fallback
  }
}

async function configuredLoadout(
  bin: string,
  root: string,
  options?: HarnessLoadoutOptions,
): Promise<HarnessLoadout> {
  const [mcpResult, pluginResult, modelResult] = await Promise.all([
    capture(bin, ['mcp', 'list', '--json'], root),
    capture(bin, ['plugin', 'list', '--json'], root),
    probeCodexModels(bin, root, options?.model, options?.env),
  ])
  const pluginWire = parseJson<any>(pluginResult.stdout, {})
  const plugins: CodexPlugin[] = (Array.isArray(pluginWire?.installed) ? pluginWire.installed : [])
    .map((plugin: any) => ({
      name: String(plugin?.name ?? plugin?.pluginId?.split('@')[0] ?? ''),
      path: String(plugin?.source?.path ?? ''),
      enabled: plugin?.enabled === true,
    }))
    .filter((plugin: CodexPlugin) => !!plugin.name && !!plugin.path)
  const mcpWire = parseJson<any[]>(mcpResult.stdout, [])
  return {
    ok: mcpResult.code === 0 && pluginResult.code === 0 && modelResult.ok,
    detail:
      mcpResult.code === 0 && pluginResult.code === 0 && modelResult.ok
        ? `${modelResult.detail ?? 'Codex model resolved.'} Runtime tools are discovered when a turn starts.`
        : (
            mcpResult.stderr ||
            pluginResult.stderr ||
            modelResult.detail ||
            'Codex loadout probe failed'
          ).trim(),
    model: modelResult.model,
    nativeModel: modelResult.nativeModel,
    modelSource: modelResult.modelSource,
    models: modelResult.models,
    cwd: root,
    tools: [],
    mcpServers: mcpWire.map((server) => ({
      name: String(server?.name ?? ''),
      status: server?.enabled === false ? 'disabled' : String(server?.auth_status ?? 'configured'),
    })),
    skills: scanCodexSkills(root, plugins),
    agents: [],
    builtinCommandCount: 0,
    probedAt: Date.now(),
    source: 'configured',
  }
}

export class CodexHarness implements AgentHarness {
  id = 'codex'
  label = 'Codex (local)'
  capabilities = {
    effortLevels: ['minimal', 'low', 'medium', 'high', 'xhigh'],
    accessLevels: ['workspace', 'full'],
    ask: true,
    loadout: true,
    gateway: 'none',
  } as const

  private availCache?: { at: number; health: HarnessHealth }
  private loadoutCache?: { at: number; key: string; data: HarnessLoadout }

  constructor(private readonly bin = DEFAULT_BIN) {}

  async health(): Promise<HarnessHealth> {
    const now = Date.now()
    if (this.availCache && now - this.availCache.at < 30_000) return this.availCache.health
    const result = await capture(this.bin, ['--version'], process.cwd())
    const health: HarnessHealth = {
      ok: result.code === 0,
      version: result.code === 0 ? result.stdout.trim() || undefined : undefined,
      bin: this.bin,
      detail:
        result.code === 0
          ? undefined
          : result.stderr.trim() ||
            `\`${this.bin}\` was not found on PATH; install it and run \`codex login\``,
    }
    this.availCache = { at: now, health }
    return health
  }

  async isAvailable(): Promise<boolean> {
    return (await this.health()).ok
  }

  run(input: AgentTurnInput): Promise<AgentTurnResult> {
    return runExec(this.bin, input)
  }

  async ask(input: AskInput): Promise<AskResult> {
    let result = await runCodexForkAsk(this.bin, input)
    // Once an attempt has streamed text, retrying would concatenate two answers in
    // the client. Surface that attempt's error instead of contaminating the stream.
    if (result.isError && result.text) return result
    if (result.isError && result.errorMessage !== 'canceled' && input.sessionId)
      result = await runCodexForkAsk(this.bin, { ...input, sessionId: undefined })
    if (!result.isError || result.errorMessage === 'canceled') return result
    if (result.text) return result

    let streamed = ''
    const fallback = await runExec(
      this.bin,
      {
        ...input,
        // `codex exec resume` would mutate the parent conversation, violating Ask's
        // fork contract. A last-resort exec fallback must therefore be fresh.
        sessionId: undefined,
        mcpServers: [],
        onEvent: (event) => {
          if (event.kind === 'message') {
            streamed = event.text
            input.onDelta(event.text)
          }
        },
      },
      true,
    )
    return {
      text: fallback.finalText || streamed,
      isError: fallback.isError,
      errorMessage: fallback.errorMessage,
    }
  }

  async loadout(root: string, options?: HarnessLoadoutOptions): Promise<HarnessLoadout> {
    const now = Date.now()
    const key = `${root}\u0000${options?.model ?? ''}\u0000${JSON.stringify(options?.env ?? {})}`
    if (this.loadoutCache && this.loadoutCache.key === key && now - this.loadoutCache.at < 60_000)
      return this.loadoutCache.data
    const data = await configuredLoadout(this.bin, root, options)
    this.loadoutCache = { at: now, key, data }
    return data
  }

  async skillContent(
    root: string,
    command: string,
  ): Promise<{ command: string; content: string; path: string } | null> {
    const loadout = await this.loadout(root)
    return readSkillContent(loadout.skills, command)
  }
}
