import type { HarnessLoadout } from '../../../../shared/types'
import type { HarnessLoadoutOptions } from '../adapter'

import { captureCommand } from '../process'
import { probeCodexModels } from './models'
import { scanCodexSkills, type CodexPlugin } from './skills'

function parseJson<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T
  } catch {
    return fallback
  }
}

/** Inspect Codex configuration, plugins, skills, MCP servers, and models. */
export async function loadCodexConfiguration(
  bin: string,
  root: string,
  options?: HarnessLoadoutOptions,
): Promise<HarnessLoadout> {
  const [mcpResult, pluginResult, modelResult] = await Promise.all([
    captureCommand(bin, ['mcp', 'list', '--json'], root),
    captureCommand(bin, ['plugin', 'list', '--json'], root),
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
