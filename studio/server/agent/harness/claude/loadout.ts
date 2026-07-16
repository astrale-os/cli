import { spawn } from 'node:child_process'

import type { HarnessLoadout } from '../../../../shared/types'
import type { HarnessHealth, HarnessLoadoutOptions } from '../adapter'

import { captureCommand, childEnvironment, terminateProcessTree } from '../process'
import { reconcileLoadedSkills, scanClaudeSkills } from '../skills'
import { buildClaudeProbeArgs } from './command'

interface InitProbe {
  ok: boolean
  detail?: string
  init?: any
}

/** Probe the installed Claude binary and version. */
export async function probeClaudeHealth(bin: string, signal?: AbortSignal): Promise<HarnessHealth> {
  const result = await captureCommand(bin, ['--version'], process.cwd(), { signal })
  return {
    ok: result.code === 0,
    version: result.code === 0 ? result.stdout.trim() || undefined : undefined,
    bin,
    detail:
      result.code === 0 ? undefined : result.stderr.trim() || `\`${bin}\` was not found on PATH`,
  }
}

/** Inspect Claude's authoritative runtime initialization event. */
export async function loadClaudeConfiguration(
  bin: string,
  root: string,
  options?: HarnessLoadoutOptions,
): Promise<HarnessLoadout> {
  const now = Date.now()
  const probe = await probeClaudeInit(bin, root, options)
  if (!probe.ok || !probe.init)
    return {
      ok: false,
      detail: probe.detail,
      tools: [],
      mcpServers: [],
      skills: [],
      agents: [],
      builtinCommandCount: 0,
      probedAt: now,
    }

  const init = probe.init
  const slash: string[] = Array.isArray(init.slash_commands) ? init.slash_commands : []
  const installed = scanClaudeSkills(root)
  const skillCommands = new Set(installed.map((skill) => skill.command))
  return {
    ok: true,
    model: init.model,
    nativeModel: options?.model ? undefined : init.model,
    modelSource: options?.model ? 'studio' : 'runtime',
    permissionMode: init.permissionMode,
    apiKeySource: init.apiKeySource,
    cwd: init.cwd,
    tools: Array.isArray(init.tools) ? init.tools : [],
    mcpServers: Array.isArray(init.mcp_servers)
      ? init.mcp_servers.map((server: any) => ({
          name: String(server?.name ?? ''),
          status: String(server?.status ?? 'unknown'),
        }))
      : [],
    skills: reconcileLoadedSkills(installed, slash),
    agents: Array.isArray(init.agents) ? init.agents : [],
    builtinCommandCount: slash.filter((command) => !skillCommands.has(command)).length,
    probedAt: now,
    source: 'runtime',
  }
}

function probeClaudeInit(
  bin: string,
  root: string,
  options?: HarnessLoadoutOptions,
): Promise<InitProbe> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(bin, buildClaudeProbeArgs(options?.model), {
        cwd: root,
        stdio: ['pipe', 'pipe', 'ignore'],
        env: childEnvironment(options?.env),
        detached: process.platform !== 'win32',
      })
    } catch (error) {
      resolve({ ok: false, detail: `failed to spawn ${bin}: ${String(error)}` })
      return
    }
    let done = false
    const finish = (result: InitProbe) => {
      if (done) return
      done = true
      clearTimeout(timer)
      terminateProcessTree(child, 'SIGKILL')
      resolve(result)
    }
    const timer = setTimeout(() => finish({ ok: false, detail: 'loadout probe timed out' }), 15_000)
    child.on('error', (error) =>
      finish({ ok: false, detail: `failed to spawn ${bin}: ${error.message}` }),
    )
    child.on('close', () => finish({ ok: false, detail: 'probe ended before an init event' }))
    child.stdin?.write('.')
    child.stdin?.end()

    let buffer = ''
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      buffer += chunk
      let newline: number
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (!line) continue
        let event: any
        try {
          event = JSON.parse(line)
        } catch {
          continue
        }
        if (event.type === 'system' && event.subtype === 'init') {
          finish({ ok: true, init: event })
          return
        }
      }
    })
  })
}
