/**
 * agent/claude.ts — the Claude Code harness. Drives a LOCAL `claude` install in
 * headless streaming mode (no cloud API key of ours — it uses the user's own
 * Claude Code auth). One invocation = one turn; `--resume <sessionId>` threads
 * the conversation across turns so the agent remembers prior comments.
 *
 *   claude -p --output-format stream-json --verbose
 *          --permission-mode <mode> [--resume <sid>] [--mcp-config <file>]
 *          [--append-system-prompt <proto>]
 *   (the turn prompt is piped on stdin so it is never argv-length-bounded)
 */
import { spawn } from 'node:child_process'

import type { HarnessLoadout } from '../../shared/types'
import type {
  AgentHarness,
  AgentTurnInput,
  AgentTurnResult,
  AskInput,
  AskResult,
  HarnessHealth,
  HarnessLoadoutOptions,
} from './types'

import { writeClaudeMcpConfig } from './mcp-config'
import { readSkillContent, reconcileLoadedSkills, scanClaudeSkills } from './skills'

const DEFAULT_BIN = process.env.DOMAIN_STUDIO_CLAUDE_BIN || 'claude'
/** Phrases Claude Code emits when `--resume <id>` names a session it can no longer
 *  find (pruned/expired/foreign cwd). Kept strict so an unrelated failure is never
 *  mistaken for a dead session (which would needlessly drop a valid conversation). */
const RESUME_REJECTED =
  /no conversation found|session (?:id .*)?(?:not found|does not exist|no longer exists|expired)|could not (?:find|load|resume) .*session|unknown session|invalid session id/i
// bypassPermissions lets the agent edit + run commands without an interactive
// prompt — correct for a local, user-initiated loop on the user's own domain.
const PERMISSION_MODE = process.env.DOMAIN_STUDIO_AGENT_PERMISSION || 'bypassPermissions'
const EXTRA_ARGS = (process.env.DOMAIN_STUDIO_CLAUDE_ARGS || '').split(' ').filter(Boolean)

/** Build the child env: the studio's own env plus any per-domain overrides (a
 *  custom model gateway's ANTHROPIC_*). Returns undefined when there are no
 *  overrides so the child plainly inherits `process.env` (the prior behaviour) —
 *  and crucially these vars live ONLY in the spawned child, never the studio
 *  process or the user's shell. */
function childEnv(extra?: Record<string, string>): NodeJS.ProcessEnv | undefined {
  return extra && Object.keys(extra).length ? { ...process.env, ...extra } : undefined
}

/** Compact a tool_use block into a one-line target for the activity log. */
function toolTarget(name: string, input: Record<string, unknown> | undefined): string {
  if (!input) return ''
  const s = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v))
  switch (name) {
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
    case 'NotebookEdit':
      return s(input.file_path ?? input.path ?? input.notebook_path)
    case 'Read':
      return s(input.file_path)
    case 'Bash':
      return s(input.command).slice(0, 200)
    case 'Grep':
      return s(input.pattern)
    case 'Glob':
      return s(input.pattern)
    case 'Task':
      return s(input.description)
    default: {
      // MCP tools (mcp__domain-studio__reply_to_thread …) + anything else
      const first = Object.values(input)[0]
      return s(first).slice(0, 200)
    }
  }
}

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

  // cache the version probe — getSnapshot is polled, no need to spawn each time
  private availCache?: { at: number; ok: boolean }
  // cache the loadout probe per (root + env) — the Settings dialog may re-open
  // often; the env is part of the key so switching gateway re-probes the model
  private loadoutCache?: { at: number; key: string; data: HarnessLoadout }

  constructor(private readonly bin = DEFAULT_BIN) {}

  async isAvailable(): Promise<boolean> {
    const now = Date.now()
    if (this.availCache && now - this.availCache.at < 30_000) return this.availCache.ok
    const ok = await new Promise<boolean>((resolve) => {
      try {
        const p = spawn(this.bin, ['--version'], { stdio: ['ignore', 'ignore', 'ignore'] })
        p.on('error', () => resolve(false))
        p.on('close', (code) => resolve(code === 0))
      } catch {
        resolve(false)
      }
    })
    this.availCache = { at: now, ok }
    return ok
  }

  /** Richer install probe for the UI: is the `claude` binary found + what version? */
  async health(): Promise<HarnessHealth> {
    const probe = await new Promise<{ ok: boolean; out: string; err: string }>((resolve) => {
      try {
        const p = spawn(this.bin, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] })
        let out = ''
        let err = ''
        p.stdout?.on('data', (d) => {
          out += d
        })
        p.stderr?.on('data', (d) => {
          err += d
        })
        p.on('error', (e) =>
          resolve({ ok: false, out: '', err: String((e as Error)?.message ?? e) }),
        )
        p.on('close', (code) => resolve({ ok: code === 0, out: out.trim(), err: err.trim() }))
      } catch (e) {
        resolve({ ok: false, out: '', err: String(e) })
      }
    })
    this.availCache = { at: Date.now(), ok: probe.ok }
    return {
      ok: probe.ok,
      version: probe.ok ? probe.out || undefined : undefined,
      bin: this.bin,
      detail: probe.ok ? undefined : probe.err || `\`${this.bin}\` was not found on PATH`,
    }
  }

  /** What did the harness ACTUALLY load for `root`? Reads the `system/init` event
   *  of a headless probe (authoritative — reflects enable/disable, cwd scope, MCP
   *  auth) and reconciles its slash-commands against on-disk skills. Cached ~60s. */
  async loadout(root: string, options?: HarnessLoadoutOptions): Promise<HarnessLoadout> {
    const now = Date.now()
    const key = `${root}\u0000${options?.model ?? ''}\u0000${JSON.stringify(options?.env ?? {})}`
    if (this.loadoutCache && this.loadoutCache.key === key && now - this.loadoutCache.at < 60_000)
      return this.loadoutCache.data
    const probe = await this.probeInit(root, options)
    let data: HarnessLoadout
    if (!probe.ok || !probe.init) {
      data = {
        ok: false,
        detail: probe.detail,
        tools: [],
        mcpServers: [],
        skills: [],
        agents: [],
        builtinCommandCount: 0,
        probedAt: now,
      }
    } else {
      const init = probe.init
      const slash: string[] = Array.isArray(init.slash_commands) ? init.slash_commands : []
      const slashSet = new Set(slash)
      const installed = scanClaudeSkills(root)
      const skillCommands = new Set(installed.map((s) => s.command))
      data = {
        ok: true,
        model: init.model,
        nativeModel: options?.model ? undefined : init.model,
        modelSource: options?.model ? 'studio' : 'runtime',
        permissionMode: init.permissionMode,
        apiKeySource: init.apiKeySource,
        cwd: init.cwd,
        tools: Array.isArray(init.tools) ? init.tools : [],
        mcpServers: Array.isArray(init.mcp_servers)
          ? init.mcp_servers.map((m: any) => ({
              name: String(m?.name ?? ''),
              status: String(m?.status ?? 'unknown'),
            }))
          : [],
        skills: reconcileLoadedSkills(installed, [...slashSet]),
        agents: Array.isArray(init.agents) ? init.agents : [],
        builtinCommandCount: slash.filter((c) => !skillCommands.has(c)).length,
        probedAt: now,
        source: 'runtime',
      }
    }
    this.loadoutCache = { at: now, key, data }
    return data
  }

  /** The raw SKILL.md for a skill command (for the "view skill" action). */
  async skillContent(
    root: string,
    command: string,
  ): Promise<{ command: string; content: string; path: string } | null> {
    return readSkillContent(scanClaudeSkills(root), command)
  }

  /** Spawn the harness in headless stream-json mode and resolve on the first
   *  `system/init` event, then KILL it — init is emitted before the first model
   *  call, so this costs ~0 tokens. A 15s timeout / early close ⇒ a !ok result. */
  private probeInit(
    root: string,
    options?: HarnessLoadoutOptions,
  ): Promise<{ ok: boolean; detail?: string; init?: any }> {
    return new Promise((resolve) => {
      const args = ['-p', '--output-format', 'stream-json', '--verbose', ...EXTRA_ARGS]
      if (options?.model) args.push('--model', options.model)
      let child: ReturnType<typeof spawn>
      try {
        child = spawn(this.bin, args, {
          cwd: root,
          stdio: ['pipe', 'pipe', 'ignore'],
          env: childEnv(options?.env),
        })
      } catch (e) {
        resolve({
          ok: false,
          detail: `failed to spawn ${this.bin}: ${String((e as Error)?.message ?? e)}`,
        })
        return
      }
      let done = false
      const finish = (r: { ok: boolean; detail?: string; init?: any }) => {
        if (done) return
        done = true
        clearTimeout(timer)
        try {
          child.kill('SIGKILL')
        } catch {
          /* already gone */
        }
        resolve(r)
      }
      const timer = setTimeout(
        () => finish({ ok: false, detail: 'loadout probe timed out' }),
        15_000,
      )
      child.on('error', (e) =>
        finish({ ok: false, detail: `failed to spawn ${this.bin}: ${e.message}` }),
      )
      child.on('close', () => finish({ ok: false, detail: 'probe ended before an init event' }))
      // -p needs an input; a single char is enough — we kill on init, before any model call
      try {
        child.stdin?.write('.')
        child.stdin?.end()
      } catch {
        /* stdin may already be closed */
      }
      let buf = ''
      child.stdout?.setEncoding('utf8')
      child.stdout?.on('data', (chunk: string) => {
        buf += chunk
        let nl: number
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim()
          buf = buf.slice(nl + 1)
          if (!line) continue
          let ev: any
          try {
            ev = JSON.parse(line)
          } catch {
            continue
          }
          if (ev.type === 'system' && ev.subtype === 'init') {
            finish({ ok: true, init: ev })
            return
          }
        }
      })
    })
  }

  run(input: AgentTurnInput): Promise<AgentTurnResult> {
    const {
      root,
      prompt,
      appendSystemPrompt,
      sessionId,
      model,
      effort,
      access,
      mcpServers,
      env,
      signal,
      onEvent,
    } = input

    const permissionMode =
      process.env.DOMAIN_STUDIO_AGENT_PERMISSION ||
      (access === 'workspace' ? 'acceptEdits' : PERMISSION_MODE)
    const mcp = writeClaudeMcpConfig(root, mcpServers)
    const args = [
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      permissionMode,
    ]
    if (sessionId) args.push('--resume', sessionId)
    if (model) args.push('--model', model)
    if (effort) args.push('--effort', effort)
    if (mcp.path) args.push('--mcp-config', mcp.path)
    if (appendSystemPrompt) args.push('--append-system-prompt', appendSystemPrompt)
    args.push(...EXTRA_ARGS)

    return new Promise((resolve) => {
      let resolvedSession = sessionId
      let finalText = ''
      let costUsd: number | undefined
      let numTurns: number | undefined
      let tokens: number | undefined
      let isError = false
      let errorMessage: string | undefined
      let stderr = ''

      const child = spawn(this.bin, args, {
        cwd: root,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: childEnv(env),
      })

      const onAbort = () => {
        try {
          child.kill('SIGTERM')
        } catch {
          /* already gone */
        }
      }
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })

      // feed the turn prompt on stdin
      child.stdin.write(prompt)
      child.stdin.end()

      let buf = ''
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        buf += chunk
        let nl: number
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim()
          buf = buf.slice(nl + 1)
          if (line) handleLine(line)
        }
      })
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (c: string) => {
        stderr += c
      })

      function handleLine(line: string) {
        let ev: any
        try {
          ev = JSON.parse(line)
        } catch {
          return // non-JSON noise
        }
        switch (ev.type) {
          case 'system':
            if (ev.subtype === 'init') {
              if (ev.session_id) resolvedSession = ev.session_id
              onEvent({ kind: 'status', text: 'session started' })
            }
            // hook_started / hook_response are noise — ignore
            return
          case 'assistant': {
            const content = ev.message?.content
            if (!Array.isArray(content)) return
            for (const block of content) {
              if (block.type === 'text' && block.text?.trim()) {
                onEvent({ kind: 'message', text: block.text.trim() })
              } else if (block.type === 'thinking' && block.thinking?.trim()) {
                onEvent({ kind: 'thinking', text: block.thinking.trim() })
              } else if (block.type === 'tool_use') {
                onEvent({
                  kind: 'tool',
                  text: block.name,
                  tool: block.name,
                  target: toolTarget(block.name, block.input),
                })
              }
            }
            return
          }
          case 'result': {
            if (typeof ev.result === 'string') finalText = ev.result
            if (typeof ev.total_cost_usd === 'number') costUsd = ev.total_cost_usd
            if (typeof ev.num_turns === 'number') numTurns = ev.num_turns
            if (ev.usage && typeof ev.usage === 'object') {
              const u = ev.usage as Record<string, number | undefined>
              tokens =
                (u.input_tokens ?? 0) +
                (u.output_tokens ?? 0) +
                (u.cache_read_input_tokens ?? 0) +
                (u.cache_creation_input_tokens ?? 0)
            }
            if (ev.session_id) resolvedSession = ev.session_id
            if (
              ev.is_error ||
              ev.subtype === 'error_during_execution' ||
              ev.subtype === 'error_max_turns'
            ) {
              isError = true
              errorMessage = ev.subtype || 'agent error'
            }
            return
          }
          case 'rate_limit_event': {
            const info = ev.rate_limit_info
            if (info && info.status && info.status !== 'allowed') {
              onEvent({ kind: 'status', text: `rate limit: ${info.status}` })
            }
            return
          }
        }
      }

      child.on('error', (err) => {
        mcp.dispose()
        resolve({
          sessionId: resolvedSession,
          finalText,
          costUsd,
          numTurns,
          tokens,
          isError: true,
          errorMessage: `failed to spawn ${this.bin}: ${err.message}`,
        })
      })

      child.on('close', (code) => {
        mcp.dispose()
        if (signal.aborted) {
          resolve({
            sessionId: resolvedSession,
            finalText,
            costUsd,
            numTurns,
            tokens,
            isError: true,
            errorMessage: 'canceled',
          })
          return
        }
        if (code !== 0 && !finalText) {
          isError = true
          errorMessage =
            errorMessage || `claude exited ${code}${stderr ? `: ${stderr.slice(-400)}` : ''}`
        }
        // Only meaningful when we actually tried to resume: did Claude reject the id?
        const resumeRejected =
          !!sessionId &&
          (isError || code !== 0) &&
          RESUME_REJECTED.test(`${errorMessage ?? ''}\n${stderr}`)
        resolve({
          sessionId: resolvedSession,
          finalText,
          costUsd,
          numTurns,
          tokens,
          isError,
          errorMessage,
          resumeRejected,
        })
      })
    })
  }

  /**
   * A quick, EPHEMERAL side-question. Forks the domain's live session (`--resume …
   * --fork-session`) so it inherits the full conversation context but writes nothing
   * back to the parent transcript. Same model/tool surface/permission mode as the
   * main agent, with the same configured effort.
   */
  ask(input: AskInput): Promise<AskResult> {
    const {
      root,
      prompt,
      appendSystemPrompt,
      sessionId,
      model,
      effort,
      access,
      env,
      signal,
      onDelta,
    } = input
    const permissionMode =
      process.env.DOMAIN_STUDIO_AGENT_PERMISSION ||
      (access === 'workspace' ? 'acceptEdits' : PERMISSION_MODE)

    const args = [
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      permissionMode,
    ]
    if (model) args.push('--model', model)
    if (effort) args.push('--effort', effort)
    // forking inherits context but leaves the parent untouched; --no-session-persistence
    // means the fork itself isn't saved either (truly ephemeral). No fork ⇒ a fresh ask.
    if (sessionId) args.push('--resume', sessionId, '--fork-session')
    args.push('--no-session-persistence')
    if (appendSystemPrompt) args.push('--append-system-prompt', appendSystemPrompt)
    args.push(...EXTRA_ARGS)

    return new Promise((resolve) => {
      let finalText = ''
      let stderr = ''
      let isError = false
      let errorMessage: string | undefined

      const child = spawn(this.bin, args, {
        cwd: root,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: childEnv(env),
      })
      const onAbort = () => {
        try {
          child.kill('SIGTERM')
        } catch {
          /* already gone */
        }
      }
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })

      child.stdin.write(prompt)
      child.stdin.end()

      let buf = ''
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        buf += chunk
        let nl: number
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim()
          buf = buf.slice(nl + 1)
          if (!line) continue
          let ev: any
          try {
            ev = JSON.parse(line)
          } catch {
            continue
          }
          if (ev.type === 'assistant' && Array.isArray(ev.message?.content)) {
            for (const b of ev.message.content) if (b.type === 'text' && b.text) onDelta(b.text)
          } else if (ev.type === 'result') {
            if (typeof ev.result === 'string') finalText = ev.result
            if (
              ev.is_error ||
              ev.subtype === 'error_during_execution' ||
              ev.subtype === 'error_max_turns'
            ) {
              isError = true
              errorMessage = ev.subtype || 'ask error'
            }
          }
        }
      })
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (c: string) => {
        stderr += c
      })

      child.on('error', (err) =>
        resolve({
          text: finalText,
          isError: true,
          errorMessage: `failed to spawn ${this.bin}: ${err.message}`,
        }),
      )
      child.on('close', (code) => {
        if (signal.aborted)
          return resolve({ text: finalText, isError: true, errorMessage: 'canceled' })
        if (code !== 0 && !finalText) {
          isError = true
          errorMessage =
            errorMessage || `claude exited ${code}${stderr ? `: ${stderr.slice(-300)}` : ''}`
        }
        resolve({ text: finalText, isError, errorMessage })
      })
    })
  }
}
