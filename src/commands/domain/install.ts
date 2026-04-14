import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import type { CommandDefinition } from '../../command'
import type { KernelCommandOpts } from '../../kernel'

import { runKernelCommand } from '../../kernel'
import { buildIdentityBinding, loadPrivateJwk } from '../../lib/domain-identity'
import { log } from '../../lib/log'
import { output } from '../../lib/output'

type InstallResult = { domainId: string; refsMapping: Record<string, string> }

export default {
  name: 'install',
  description: 'Install a domain from a pre-compiled spec.json file',
  arguments: [{ name: 'spec-file', description: 'Path to the spec.json file', required: true }],
  options: [
    {
      flags: '-k, --key <path>',
      description: 'Path to a JWK private key file (.json) for identity binding',
    },
  ],
  action: async (specFile: string, opts: KernelCommandOpts & { key?: string }) => {
    const filePath = resolve(specFile)

    let raw: string
    try {
      raw = await readFile(filePath, 'utf-8')
    } catch {
      log.error(`Cannot read spec file: ${filePath}`)
      process.exit(1)
    }

    let spec: { nodes?: unknown; edges?: unknown }
    try {
      spec = JSON.parse(raw)
    } catch {
      log.error(`Invalid JSON in ${specFile}`)
      process.exit(1)
    }

    if (!Array.isArray(spec.nodes) || !Array.isArray(spec.edges)) {
      log.error('Spec file must contain { nodes: [...], edges: [...] }')
      process.exit(1)
    }

    let identity: Awaited<ReturnType<typeof buildIdentityBinding>> | undefined
    if (opts.key) {
      const privateJwk = await loadPrivateJwk(opts.key)
      identity = await buildIdentityBinding(
        spec as Parameters<typeof buildIdentityBinding>[0],
        privateJwk,
      )
      log.dim(`  Identity binding prepared (${identity.publicKey.jwk.kid ?? 'no kid'})`)
    }

    await runKernelCommand<InstallResult>({
      opts,
      label: `Installing domain from ${specFile}`,
      fn: (ctx) =>
        ctx.client.call(
          '/kernel.astrale.ai/Root/installDomain',
          { spec, identity },
          ctx.credential,
        ) as Promise<InstallResult>,
      format: (result, fmtOpts, isRaw) => {
        if (isRaw) {
          output(result, fmtOpts)
          return
        }
        log.success(`Domain installed: ${result.domainId}`)
        const refCount = Object.keys(result.refsMapping).length
        if (refCount > 0) {
          log.dim(`  ${refCount} ref(s) mapped`)
        }
      },
    })
  },
} satisfies CommandDefinition
