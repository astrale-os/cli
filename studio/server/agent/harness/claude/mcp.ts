import { randomUUID } from 'node:crypto'

import type { HarnessMcpServer } from '../adapter'

import { removeState, statePath, writeJson } from '../../../state/store'

export interface TemporaryMcpConfig {
  path?: string
  dispose(): void
}

/** Serialize Studio MCP grants into Claude Code's temporary JSON format. */
export function writeClaudeMcpConfig(
  root: string,
  servers: HarnessMcpServer[] | undefined,
): TemporaryMcpConfig {
  if (!servers?.length) return { dispose: () => {} }
  const rel = `.cache/agent/claude-mcp-${randomUUID()}.json`
  writeJson(root, rel, {
    mcpServers: Object.fromEntries(
      servers.map((server) => [
        server.name,
        {
          command: server.command,
          ...(server.args?.length ? { args: server.args } : {}),
          ...(server.env && Object.keys(server.env).length ? { env: server.env } : {}),
        },
      ]),
    ),
  })
  return {
    path: statePath(root, rel),
    dispose: () => {
      try {
        removeState(root, rel)
      } catch {
        /* best-effort temp cleanup */
      }
    },
  }
}
