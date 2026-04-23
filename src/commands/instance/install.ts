import { access, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import type { CommandDefinition } from '../../command'
import type { KernelCommandOpts } from '../../kernel'

import { AstraleError } from '../../errors'
import { runKernelCommand } from '../../kernel'
import { isBuiltinDomainName, resolveBuiltinDomain } from '../../lib/builtin-domains'
import { buildIdentityBinding, loadPrivateJwk } from '../../lib/domain-identity'
import { fatal, log } from '../../lib/log'
import { output } from '../../lib/output'

type InstallResult = { domainId: string; origin: string }

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

const KERNEL_DOMAIN_CLASS = '/:kernel.astrale.ai:class.Domain'

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
    const props = (node as { props?: { origin?: unknown } }).props
    const origin = typeof props?.origin === 'string' ? props.origin : undefined
    if (origin) return origin
    const path = (node as { path?: unknown }).path
    if (typeof path === 'string' && path.startsWith('/')) return path.slice(1)
    return undefined
  }
  return undefined
}

export default {
  name: 'install',
  description: 'Install a compiled domain spec on the target instance (§9)',
  arguments: [{ name: 'spec-file', description: 'Path to the spec.json file', required: true }],
  options: [
    {
      flags: '-k, --key <path>',
      description: 'Path to a JWK private key file (.json) for identity binding',
    },
  ],
  action: async (specFile: string, opts: KernelCommandOpts & { key?: string }) => {
    // Builtin resolution: if specFile is not an existing path and matches a
    // builtin name, resolve spec + key via resolveBuiltinDomain.
    let filePath = resolve(specFile)
    let resolvedKey = opts.key
    const looksLikePath = specFile.includes('/') || specFile.endsWith('.json')
    const fileExists = await access(filePath).then(
      () => true,
      () => false,
    )
    if (!fileExists && !looksLikePath && isBuiltinDomainName(specFile)) {
      const builtin = await resolveBuiltinDomain(specFile)
      filePath = builtin.specPath
      resolvedKey = resolvedKey ?? builtin.keyPath
      log.dim(`  builtin "${specFile}" resolved via ${builtin.source}`)
    }

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
    if (resolvedKey) {
      try {
        const privateJwk = await loadPrivateJwk(resolvedKey)
        identity = await buildIdentityBinding(
          spec as Parameters<typeof buildIdentityBinding>[0],
          privateJwk,
          resolvedKey,
        )
      } catch (e) {
        // Pre-flight validation errors (bad JWK, mismatched pair) should
        // surface as a clean error, not an uncaught Bun stack trace.
        fatal(e)
      }
      log.dim(`  Identity binding prepared (${identity.publicKey.jwk.kid ?? 'no kid'})`)
    }

    // Strip meta — it's spec-build provenance, not part of the install payload.
    const { meta: _meta, ...specPayload } = spec

    await runKernelCommand<InstallResult>({
      opts,
      label: `Installing domain from ${specFile}`,
      fn: async (ctx) => {
        try {
          return (await ctx.client.call(
            '/kernel.astrale.ai/class.Root/installDomain',
            { spec: specPayload, identity },
            ctx.credential,
          )) as InstallResult
        } catch (e) {
          // Re-throw sig failures with the -k context so the user doesn't
          // have to guess which key is being rejected. The kernel's generic
          // `signature verification failed` has no pointer to the caller's
          // file.
          if (resolvedKey && isSignatureVerificationError(e)) {
            throw new AstraleError(
              'INVALID_IDENTITY_BINDING',
              `Kernel rejected the identity binding derived from ${resolvedKey} — the private key's signature does not verify against the public half sent in the same file.`,
              'Re-check that the `d` and `x` in your JWK form a real pair (derive the public from the private via jose.exportJWK and compare), or regenerate with `astrale domain init` / a fresh keygen.',
            )
          }
          throw e
        }
      },
      format: (result, fmtOpts, isRaw) => {
        if (isRaw) {
          output(result, fmtOpts)
          return
        }
        log.success(`Domain installed: ${result.origin}`)
        log.dim(`  domainId: ${result.domainId}`)
      },
    })
  },
} satisfies CommandDefinition

function isSignatureVerificationError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false
  const name = (e as { name?: unknown }).name
  const msg = (e as { message?: unknown }).message
  return (
    name === 'AuthenticationError' &&
    typeof msg === 'string' &&
    /signature verification failed/i.test(msg)
  )
}
