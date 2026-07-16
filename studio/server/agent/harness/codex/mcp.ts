import type { HarnessMcpServer } from '../adapter'

export function tomlString(value: string): string {
  return JSON.stringify(value)
}

function tomlStringMap(values: Record<string, string>): string {
  return `{${Object.entries(values)
    .map(([key, value]) => `${key}=${tomlString(value)}`)
    .join(',')}}`
}

/** Serialize Studio MCP grants into Codex CLI config overrides. */
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
