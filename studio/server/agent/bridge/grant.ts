import { randomUUID } from 'node:crypto'
import { chmodSync } from 'node:fs'
import { join } from 'node:path'

import type { StudioEvent } from '../../../shared/types'
import type { DomainHandle } from '../../domain'
import type { HarnessMcpServer } from '../harness/adapter'

import { studioCliCommand } from '../../cli'
import { removeState, statePath, writeJson } from '../../state/store'
import { openBridgeSession } from './routes'

export interface Bridge {
  enabled: boolean
  mcpServers: HarnessMcpServer[]
  onReply(callback: (commentId: string, text: string) => void): void
  onProgress(callback: (text: string) => void): void
  dispose(): void
}

const TOOL_ROUTES: Record<string, string> = {
  list_open_threads: 'threads',
  reply_to_thread: 'reply',
  resolve_thread: 'resolve',
  post_progress: 'progress',
  raise_question: 'raise_question',
}

let studioPort = Number(process.env.PORT) || 4319

export function setBridgePort(port: number): void {
  studioPort = port
}

const MCP_SERVER = join(import.meta.dir, 'stdio.ts')

/** Mint the run-scoped MCP grant and its secret-bearing configuration file. */
export function startBridge(handle: DomainHandle, notify: (event: StudioEvent) => void): Bridge {
  const token = randomUUID()
  const fileId = randomUUID()
  const session = openBridgeSession(handle, token, notify)
  const base = `http://127.0.0.1:${studioPort}/api/domain/${encodeURIComponent(handle.id)}/agent/bridge`
  const bridgeRel = `.cache/agent/bridge-${fileId}.json`
  writeJson(handle.root, bridgeRel, { base, token })
  const bridgeConfigPath = statePath(handle.root, bridgeRel)
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
        removeState(handle.root, bridgeRel)
      } catch {
        /* best-effort */
      }
    },
  }
}
