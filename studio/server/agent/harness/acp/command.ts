import { fileURLToPath } from 'node:url'

import { studioCliCommand } from '../../../cli'

export type AcpProvider = 'claude' | 'codex'

const INTERNAL_MODES: Record<AcpProvider, string> = {
  claude: '__studio-acp-claude',
  codex: '__studio-acp-codex',
}

const PACKAGE_ENTRYPOINTS: Record<AcpProvider, string> = {
  claude: '@agentclientprotocol/claude-agent-acp/dist/index.js',
  codex: '@agentclientprotocol/codex-acp',
}

const COMMAND_OVERRIDES: Record<AcpProvider, string> = {
  claude: 'DOMAIN_STUDIO_CLAUDE_ACP_BIN',
  codex: 'DOMAIN_STUDIO_CODEX_ACP_BIN',
}

/** Resolve the bundled ACP agent server without depending on a global npm binary. */
export function acpAgentCommand(provider: AcpProvider): string[] {
  const override = process.env[COMMAND_OVERRIDES[provider]]?.trim()
  if (override) return [override]

  try {
    return studioCliCommand([INTERNAL_MODES[provider]])
  } catch {
    const entrypoint = fileURLToPath(import.meta.resolve(PACKAGE_ENTRYPOINTS[provider]))
    return [process.execPath, entrypoint]
  }
}
