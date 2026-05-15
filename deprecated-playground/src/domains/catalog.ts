import type { RemoteDomain } from '@astrale-os/sdk'

import { buildSpec } from '@astrale-os/sdk'
import { claudeCodeDomain } from '@domains/claude-code-remote/claude-code-domain'
import { gatewayDomain } from '@domains/claude-code-remote/gateway-domain'
import { distributionDomain } from '@domains/distribution/domain'

export type SampleDomain = {
  name: string
  description: string
  spec: { nodes: unknown[]; edges: unknown[] }
}

type DomainEntry = {
  name: string
  description: string
  domain: RemoteDomain
}

const DOMAIN_ENTRIES: DomainEntry[] = [
  {
    name: 'ai-gateway.astrale.ai',
    description: 'AI Gateway — Model invocation and usage tracking',
    domain: gatewayDomain,
  },
  {
    name: 'claude-code.astrale.ai',
    description: 'Claude Code — AI agent with subprocess execution',
    domain: claudeCodeDomain,
  },
  {
    name: 'distribution.astrale.ai',
    description: 'Distribution — Blaxel compute deployment',
    domain: distributionDomain,
  },
]

let cached: SampleDomain[] | null = null

export function getSampleDomains(): SampleDomain[] {
  if (cached) return cached
  cached = DOMAIN_ENTRIES.map((entry) => ({
    name: entry.name,
    description: entry.description,
    spec: buildSpec(entry.domain).toWire(),
  }))
  return cached
}
