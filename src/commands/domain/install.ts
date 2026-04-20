import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import type { CommandDefinition } from '../../command'
import type { KernelCommandOpts } from '../../kernel'

import { runKernelCommand } from '../../kernel'
import { buildIdentityBinding, loadPrivateJwk } from '../../lib/domain-identity'
import { log } from '../../lib/log'
import { output } from '../../lib/output'

type InstallResult = { domainId: string; refsMapping: Record<string, string> }

type SpecMeta = {
  baseDomain?: string
  sdkCommit?: string
  builtAt?: string
}

type SpecFile = {
  meta?: SpecMeta
  nodes?: unknown
  edges?: unknown
}

const KERNEL_DOMAIN_CLASS = '/kernel.astrale.ai/Domain'

function rawStr(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (
    value &&
    typeof value === 'object' &&
    'raw' in value &&
    typeof (value as { raw: unknown }).raw === 'string'
  ) {
    return (value as { raw: string }).raw
  }
  return undefined
}

function extractDomainSlug(nodes: unknown[]): string | undefined {
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue
    const cls = rawStr((node as { class?: unknown }).class)
    if (cls !== KERNEL_DOMAIN_CLASS && cls !== `${KERNEL_DOMAIN_CLASS}/self`) continue
    const props = (node as { properties?: { origin?: unknown } }).properties
    const origin = typeof props?.origin === 'string' ? props.origin : undefined
    const slug = (node as { slug?: unknown }).slug
    return origin ?? (typeof slug === 'string' ? slug : undefined)
  }
  return undefined
}

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

    let spec: SpecFile
    try {
      spec = JSON.parse(raw) as SpecFile
    } catch {
      log.error(`Invalid JSON in ${specFile}`)
      process.exit(1)
    }

    if (!Array.isArray(spec.nodes) || !Array.isArray(spec.edges)) {
      log.error('Spec file must contain { nodes: [...], edges: [...] }')
      process.exit(1)
    }

    const specSlug = extractDomainSlug(spec.nodes)
    const meta = spec.meta

    if (meta) {
      const stamp = [
        meta.baseDomain && `baseDomain=${meta.baseDomain}`,
        meta.sdkCommit && `sdkCommit=${meta.sdkCommit}`,
        meta.builtAt && `builtAt=${meta.builtAt}`,
      ]
        .filter(Boolean)
        .join(' ')
      log.dim(`  Spec stamp: ${stamp}`)

      if (meta.baseDomain && specSlug && meta.baseDomain !== specSlug) {
        log.error(
          `Spec stamp mismatch: meta.baseDomain="${meta.baseDomain}" but domain node slug="${specSlug}". ` +
            `Rebuild the spec (pnpm build:spec:...).`,
        )
        process.exit(1)
      }
    } else {
      log.warn(
        'Spec has no meta stamp — cannot verify baseDomain. Consider rebuilding with a current SDK.',
      )
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

    // Strip meta — it's spec-build provenance, not part of the install payload.
    const { meta: _meta, ...specPayload } = spec

    await runKernelCommand<InstallResult>({
      opts,
      label: `Installing domain from ${specFile}`,
      fn: (ctx) =>
        ctx.client.call(
          '/kernel.astrale.ai/Root/installDomain',
          { spec: specPayload, identity },
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
