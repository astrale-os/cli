import type { HarnessLoadout } from '../../../../shared/types'
import type { HarnessLoadoutOptions } from '../adapter'

import { asJsonArray, asJsonRecord, asString, parseJson } from '../../../json'
import { captureCommand } from '../process'
import { probeCodexModels } from './models'
import { scanCodexSkills, type CodexPlugin } from './skills'

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
  const pluginWire = asJsonRecord(parseJson(pluginResult.stdout))
  const plugins: CodexPlugin[] = (asJsonArray(pluginWire?.installed) ?? []).flatMap((value) => {
    const plugin = asJsonRecord(value)
    const pluginId = asString(plugin?.pluginId)
    const name = asString(plugin?.name) ?? pluginId?.split('@')[0] ?? ''
    const path = asString(asJsonRecord(plugin?.source)?.path) ?? ''
    return name && path ? [{ name, path, enabled: plugin?.enabled === true }] : []
  })
  const mcpWire = asJsonArray(parseJson(mcpResult.stdout)) ?? []
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
    mcpServers: mcpWire.map((value) => {
      const server = asJsonRecord(value)
      return {
        name: asString(server?.name) ?? '',
        status:
          server?.enabled === false ? 'disabled' : (asString(server?.auth_status) ?? 'configured'),
      }
    }),
    skills: scanCodexSkills(root, plugins),
    agents: [],
    builtinCommandCount: 0,
    probedAt: Date.now(),
    source: 'configured',
  }
}
