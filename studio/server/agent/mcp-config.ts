import { randomUUID } from 'node:crypto'

import type { HarnessMcpServer } from './types'

import { removeState, statePath, writeJson } from '../state/store'

export interface TemporaryMcpConfig {
  path?: string
  dispose(): void
}

/** Claude Code consumes a JSON file, while the harness-neutral runner carries
 * structured MCP server descriptions. Serialize that adapter-specific file here. */
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

export function tomlString(value: string): string {
  // TOML basic strings share JSON's escaping for the characters Studio emits.
  return JSON.stringify(value)
}

function tomlStringMap(values: Record<string, string>): string {
  return `{${Object.entries(values)
    .map(([key, value]) => `${key}=${tomlString(value)}`)
    .join(',')}}`
}

export function codexMcpConfigArgs(servers: HarnessMcpServer[] | undefined): string[] {
  const args: string[] = []
  for (const server of servers ?? []) {
    const prefix = `mcp_servers.${server.name}`
    const add = (key: string, value: string) => args.push('-c', `${prefix}.${key}=${value}`)
    add('command', tomlString(server.command))
    if (server.args?.length) add('args', JSON.stringify(server.args))
    if (server.env && Object.keys(server.env).length) add('env', tomlStringMap(server.env))
    if (server.required !== undefined) add('required', String(server.required))
    if (server.approvalMode) add('default_tools_approval_mode', tomlString(server.approvalMode))
    if (server.enabledTools?.length) add('enabled_tools', JSON.stringify(server.enabledTools))
  }
  return args
}
