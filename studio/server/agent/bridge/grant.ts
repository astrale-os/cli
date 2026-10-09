import { randomUUID } from 'node:crypto'
import { chmodSync } from 'node:fs'
import { join } from 'node:path'

import type { HarnessMcpServer } from '../harness/adapter'
import type { Notify } from '../notify'
import type { AgentWorkspace } from '../workspace'

import { studioCliCommand } from '../../cli'
import { removeState, statePath, writeJson } from '../../state/store'
import { openBridgeSession } from './routes'
import { BRIDGE_TOOLS } from './tools'

export interface Bridge {
  enabled: boolean
  mcpServers: HarnessMcpServer[]
  onReply(callback: (commentId: string, text: string) => void): void
  onProgress(callback: (text: string) => void): void
  dispose(): void
}

/** Each tool the MCP server advertises, by name, to the bridge route that serves it. */
const TOOL_ROUTES: Record<string, string> = Object.fromEntries(
  BRIDGE_TOOLS.map((tool) => [tool.name, tool.route]),
)

let studioPort = Number(process.env.PORT) || 4319

export function setBridgePort(port: number): void {
  studioPort = port
}

const MCP_SERVER = join(import.meta.dir, 'stdio.ts')

/**
 * Mint the run-scoped MCP grant and its secret-bearing configuration file.
 *
 * The file lives in the Studio's machine-global agent folder, never in a domain. Its
 * bearer is still scoped in memory to the workspace snapshot that minted the run.
 */
export function startBridge(workspace: AgentWorkspace, notify: Notify): Bridge {
  const token = randomUUID()
  const fileId = randomUUID()
  const session = openBridgeSession(workspace, token, notify)
  const base = `http://127.0.0.1:${studioPort}/api/agent/bridge`
  const bridgeRel = `bridge-${fileId}.json`
  writeJson(workspace.stateRoot, bridgeRel, { base, token })
  const bridgeConfigPath = statePath(workspace.stateRoot, bridgeRel)
  chmodSync(bridgeConfigPath, 0o600)

  let bridgeCommand: string[]
  try {
    bridgeCommand = studioCliCommand(['__studio-bridge', '--config', bridgeConfigPath])
  } catch {
    bridgeCommand = [
      process.env.DOMAIN_STUDIO_BRIDGE_BUN || process.execPath,
      MCP_SERVER,
      '--config',
      bridgeConfigPath,
    ]
  }

  const server: HarnessMcpServer = {
    name: 'domain-studio',
    command: bridgeCommand[0],
    args: bridgeCommand.slice(1),
    required: true,
    approvalMode: 'approve',
    enabledTools: Object.keys(TOOL_ROUTES),
    invoke: async (tool, args) => {
      const route = TOOL_ROUTES[tool]
      if (!route) throw new Error(`unknown bridge tool: ${tool}`)
      const response = await session.invoke(route, args)
      const result = await response.json()
      if (!response.ok)
        throw new Error(
          typeof result?.error === 'string'
            ? result.error
            : `bridge call failed: ${response.status}`,
        )
      return result
    },
  }

  return {
    enabled: true,
    mcpServers: [server],
    onReply: session.onReply,
    onProgress: session.onProgress,
    dispose: () => {
      session.dispose()
      try {
        removeState(workspace.stateRoot, bridgeRel)
      } catch {
        /* best-effort */
      }
    },
  }
}
