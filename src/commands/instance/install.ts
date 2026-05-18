import { access, readdir, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import type { CommandDefinition } from '../../command'
import type { KernelCommandOpts } from '../../kernel'

import { AstraleError } from '../../errors'
import { runKernelCommand } from '../../kernel'
import { isBuiltinDomainName, resolveBuiltinDomain } from '../../lib/builtin-domains'
import {
  buildIdentityBinding,
  isSignatureVerificationError,
  loadPrivateJwk,
} from '../../lib/domain-identity'
import { fatal, log } from '../../lib/log'
import { output } from '../../lib/output'
import { extractDomainSlug } from '../../lib/spec'

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

export default {
  name: 'install',
  description: 'Install a compiled domain spec on the target instance',
  afterHelpText: `
Behavior:
  Standalone command (there is no \`domain install\`). There is no
  uninstall verb today and re-install does not replace existing
  Function bindings — run \`astrale reset\` between installs when
  iterating on schema in dev. Worker key auto-detected at
  <specDir>/worker/keys/; -k overrides (a mismatch warns).

Examples:
  $ astrale instance install ./dist/spec.json -i staging --as alice
`,
  arguments: [{ name: 'spec-file', description: 'Path to the spec.json file', required: true }],
  options: [
    {
      flags: '-k, --key <path>',
      description:
        "Path to the domain worker's private JWK — the same key the worker signs callback JWTs with. " +
        'Auto-detected from `<spec-dir>/worker/keys/` when omitted.',
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

    // Always run auto-detection. Looks under `<specDir>/worker/keys/` — the
    // convention used by `minimal-remote`-scaffolded domains.
    //
    // When the user passes `-k <path>` AND the convention also has a key,
    // their explicit choice wins, but we warn loudly when those paths
    // don't match — the `-k <manager.private.jwk>` mistake (META_TRACE #35)
    // is invisible until callbacks fail with "Unrecognized credential
    // format" hours later.
    const hint = meta?.baseDomain ?? specSlug
    const autoKey = await autoDetectWorkerKey(dirname(filePath), hint)
    if (resolvedKey && autoKey && resolve(resolvedKey) !== resolve(autoKey)) {
      log.warn(`  -k ${resolvedKey} differs from the auto-detected worker key ${autoKey}.`)
      log.warn('  Using your -k. The kernel registers whichever pubkey signs this')
      log.warn('  install as the function-identity pubkey, so callbacks signed by')
      log.warn('  a different key will fail "Unrecognized credential format".')
    } else if (!resolvedKey && autoKey) {
      resolvedKey = autoKey
      log.dim(`  Auto-detected worker key: ${autoKey}`)
    } else if (!resolvedKey && !autoKey) {
      log.warn(
        '  No `-k` provided and no worker key auto-detected — installing without identity binding.',
      )
    }

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
          return (await ctx.client.call('/kernel.astrale.ai/class.Root/installDomain', {
            spec: specPayload,
            identity,
          })) as InstallResult
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

/**
 * Locate a worker private-key JWK under `<specDir>/worker/keys/`.
 *
 * Resolution order:
 *   1. `<baseDomain>-worker.jwk.json` (exact match — e.g. `dist-v2-worker.jwk.json`)
 *   2. single `*.jwk.json` file in the directory
 *
 * Returns `null` when nothing obvious matches (ambiguous or missing) —
 * the caller is expected to warn and proceed without an identity binding.
 */
async function autoDetectWorkerKey(
  specDir: string,
  baseDomain: string | undefined,
): Promise<string | null> {
  const keysDir = join(specDir, 'worker', 'keys')
  let entries: string[]
  try {
    entries = await readdir(keysDir)
  } catch {
    return null
  }
  const jwks = entries.filter((n) => n.endsWith('.jwk.json'))
  if (jwks.length === 0) return null

  if (baseDomain) {
    const exact = `${baseDomain}-worker.jwk.json`
    if (jwks.includes(exact)) return join(keysDir, exact)
  }

  if (jwks.length === 1) return join(keysDir, jwks[0]!)

  // Ambiguous — let the user pass `-k` explicitly.
  log.warn(`  Multiple .jwk.json candidates in ${keysDir}; not auto-picking — pass \`-k <path>\`.`)
  return null
}
