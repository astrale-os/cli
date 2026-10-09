import { afterAll, afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { AgentBinary } from './binary'
import type { AcpProvider } from './command'

import { PINNED_AGENT_BINARIES } from './pinned-binaries'
import { prefetchAgentBinaries } from './prefetch'

const roots: string[] = []
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

const environment = process.env.DOMAIN_STUDIO_CODEX_BIN
afterEach(() => {
  if (environment === undefined) delete process.env.DOMAIN_STUDIO_CODEX_BIN
  else process.env.DOMAIN_STUDIO_CODEX_BIN = environment
})

function recorder() {
  const ensured: AgentBinary[] = []
  const pruned: AcpProvider[] = []
  return {
    ensured,
    pruned,
    dependencies: {
      ensure: async (binary: AgentBinary) => {
        ensured.push(binary)
      },
      prune: async (provider: AcpProvider) => {
        pruned.push(provider)
      },
    },
  }
}

describe('agent prefetch', () => {
  test('fetches this release’s build of each agent Studio already installed, and only those', async () => {
    const root = mkdtempSync(join(tmpdir(), 'studio-agent-prefetch-'))
    roots.push(root)
    mkdirSync(join(root, 'claude', '0.0.1'), { recursive: true })
    const { ensured, pruned, dependencies } = recorder()

    expect(await prefetchAgentBinaries(root, dependencies)).toEqual(['claude'])

    expect(ensured.map((binary) => [binary.provider, binary.pinnedVersion])).toEqual([
      ['claude', PINNED_AGENT_BINARIES.claude.version],
    ])
    expect(ensured[0].directory?.startsWith(join(root, 'claude'))).toBe(true)
    expect(pruned).toEqual(['claude'])
  })

  test('a machine that never ran an agent through Studio downloads nothing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'studio-agent-prefetch-none-'))
    roots.push(root)
    const { ensured, dependencies } = recorder()

    expect(await prefetchAgentBinaries(root, dependencies)).toEqual([])
    expect(ensured).toEqual([])
  })

  test('a failed download is left to the next turn and never stops the other agent', async () => {
    const root = mkdtempSync(join(tmpdir(), 'studio-agent-prefetch-fail-'))
    roots.push(root)
    mkdirSync(join(root, 'claude'), { recursive: true })
    mkdirSync(join(root, 'codex'), { recursive: true })
    delete process.env.DOMAIN_STUDIO_CODEX_BIN
    const pruned: AcpProvider[] = []

    const fetched = await prefetchAgentBinaries(root, {
      ensure: async (binary) => {
        if (binary.provider === 'claude') throw new Error('offline')
      },
      prune: async (provider) => {
        pruned.push(provider)
      },
    })

    expect(fetched).toEqual(['codex'])
    expect(pruned).toEqual(['claude', 'codex'])
  })
})
