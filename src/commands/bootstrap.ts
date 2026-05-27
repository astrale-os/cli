/**
 * `astrale bootstrap` — install the builtin `distribution` then `manager-ui`
 * domains onto the manager kernel itself.
 *
 * This is intentionally schema-only: no grants, no Distribution.init. It
 * mirrors the standalone `instance install` contract. `manager-ui` has zero
 * methods (nothing to grant), and `distribution` on the manager exists only
 * so the `View` class is resolvable for manager-ui's `view_for`/`View` edges.
 *
 * Product workspace distribution installation is owned by the admin create
 * workflow, not by the manager `KernelInstance.boot` primitive.
 */

import { type FnMap, ConnectionError, NotFoundError } from '@astrale-os/kernel-client'
import { ClientSession } from '@astrale-os/kernel-client/session'
import { readFile } from 'node:fs/promises'

import type { CommandDefinition } from '../command'

import { AstraleError } from '../errors'
import { resolveCredential } from '../kernel/auth'
import { resolveBuiltinDomain, type BuiltinDomainName } from '../lib/builtin-domains'
import { readConfig } from '../lib/config'
import {
  buildIdentityBinding,
  isSignatureVerificationError,
  loadPrivateJwk,
} from '../lib/domain-identity'
import { managerUrl } from '../lib/instance'
import { fatal, log } from '../lib/log'
import { probeHttp } from '../lib/manager-state'
import { isRawOutput, output, RAW_OUTPUT_OPTIONS, type OutputOpts } from '../lib/output'
import { extractDomainSlug, findFirstRemoteUrl } from '../lib/spec'

/** Install order — distribution provides the `View` class manager-ui needs. */
const ORDER: BuiltinDomainName[] = ['distribution', 'manager-ui']
const ORDER_SET: ReadonlySet<string> = new Set(ORDER)
const isBootstrapDomain = (v: string): v is BuiltinDomainName => ORDER_SET.has(v)

export type DomainState = 'installed' | 'already-installed' | 'installed/worker-down'

type DomainReport = {
  domain: BuiltinDomainName
  origin: string
  state: DomainState
  workerUrl?: string
}

type BootstrapOpts = OutputOpts & {
  as?: string
  creds?: string
  only?: string
  skipWorkerCheck?: boolean
}

/**
 * Classify a `::get` failure. Only `NotFoundError` means "domain absent,
 * go ahead and install" — every other error (auth, permission, validation)
 * is a real failure that must surface, never be treated as "not installed".
 */
export function classifyGetResult(err: unknown): 'absent' | 'fatal-connection' | 'fatal' {
  if (err instanceof NotFoundError) return 'absent'
  if (err instanceof ConnectionError) return 'fatal-connection'
  return 'fatal'
}

/** State of a freshly-installed domain (the already-installed case is decided before install). */
export function deriveState(workerProbed: boolean, workerUp: boolean): DomainState {
  return workerProbed && !workerUp ? 'installed/worker-down' : 'installed'
}

async function installOne(
  client: ClientSession<FnMap>,
  name: BuiltinDomainName,
  opts: BootstrapOpts,
): Promise<DomainReport> {
  // `resolveBuiltinDomain` throws BuiltinDomainNotFoundError (with a good
  // hint) when the spec/key can't be found — let it propagate to fatal.
  const builtin = await resolveBuiltinDomain(name)

  const raw = await readFile(builtin.specPath, 'utf-8')
  const spec = JSON.parse(raw) as { meta?: unknown; nodes?: unknown[]; edges?: unknown[] }
  if (!Array.isArray(spec.nodes) || !Array.isArray(spec.edges)) {
    throw new AstraleError(
      'INVALID_SPEC',
      `Builtin "${name}" spec is malformed (missing nodes/edges): ${builtin.specPath}`,
    )
  }

  const origin = extractDomainSlug(spec.nodes)
  if (!origin) {
    throw new AstraleError(
      'INVALID_SPEC',
      `Builtin "${name}" spec has no Domain node carrying an origin: ${builtin.specPath}`,
    )
  }

  // ── Idempotence: a resolvable Domain node means already installed ──
  try {
    await client.call(`/${origin}::get`, {})
    return { domain: name, origin, state: 'already-installed' }
  } catch (e) {
    const kind = classifyGetResult(e)
    if (kind === 'fatal-connection') {
      throw new AstraleError(
        'MANAGER_UNREACHABLE',
        `Manager became unreachable while bootstrapping "${name}".`,
        'Re-run `astrale bootstrap` once `astrale start` reports the manager up.',
      )
    }
    if (kind === 'fatal') throw e
    // 'absent' → fall through and install.
  }

  // ── Worker reachability (manager-ui only; distribution is schema-only
  //    here and its binding is the prod URL — probing it is a false alarm) ──
  let workerProbed = false
  let workerUp = false
  let workerUrl: string | undefined
  if (name === 'manager-ui' && !opts.skipWorkerCheck) {
    workerUrl = findFirstRemoteUrl(spec.nodes)
    if (workerUrl) {
      workerProbed = true
      workerUp = await probeHttp(`${new URL(workerUrl).origin}/meta`, 2000)
    }
  }

  // ── Identity binding from the domain worker's private JWK ──
  let identity: Awaited<ReturnType<typeof buildIdentityBinding>> | undefined
  if (builtin.keyPath) {
    const privateJwk = await loadPrivateJwk(builtin.keyPath)
    // buildIdentityBinding throws a clean AstraleError on a bad/mismatched
    // pair — let it propagate to the top-level fatal.
    identity = await buildIdentityBinding(
      spec as Parameters<typeof buildIdentityBinding>[0],
      privateJwk,
      builtin.keyPath,
    )
  } else {
    log.warn(
      `  ${name}: no worker key resolved — installing without identity binding ` +
        '(its View/methods will not authenticate).',
    )
  }

  // ── Install (meta is build provenance, not part of the payload) ──
  const { meta: _meta, ...specPayload } = spec
  try {
    await client.call('/kernel.astrale.ai/class.Root/installDomain', {
      spec: specPayload,
      identity,
    })
  } catch (e) {
    if (builtin.keyPath && isSignatureVerificationError(e)) {
      throw new AstraleError(
        'INVALID_IDENTITY_BINDING',
        `Kernel rejected the identity binding derived from ${builtin.keyPath} for "${name}".`,
        'Regenerate the worker keypair (the JWK private/public halves must match).',
      )
    }
    throw e
  }

  return { domain: name, origin, state: deriveState(workerProbed, workerUp), workerUrl }
}

export async function bootstrapCommand(opts: BootstrapOpts): Promise<void> {
  const config = await readConfig()
  const isRaw = isRawOutput(opts)
  const url = managerUrl(config)

  let order = ORDER
  if (opts.only !== undefined) {
    if (!isBootstrapDomain(opts.only)) {
      fatal(
        new AstraleError(
          'INVALID_DOMAIN',
          `--only "${opts.only}" is not a bootstrap domain.`,
          `Valid values: ${ORDER.join(', ')}.`,
        ),
      )
    }
    order = [opts.only]
  }

  // One clean preflight instead of a cryptic per-call ConnectionError.
  if (!(await probeHttp(`${url}/`, 2000))) {
    fatal(
      new AstraleError(
        'MANAGER_UNREACHABLE',
        `Cannot reach the manager at ${url}.`,
        'Start it with: astrale start',
      ),
    )
  }

  const credential = await resolveCredential(opts, config, config.issuer, undefined)
  const client = new ClientSession<FnMap>({ default: url, identity: credential })

  const reports: DomainReport[] = []
  try {
    for (const name of order) {
      reports.push(await installOne(client, name, opts))
    }
  } catch (e) {
    client.disconnect()
    fatal(e)
  }
  client.disconnect()

  if (isRaw || opts.format) {
    output({ manager: url, domains: reports }, opts)
    return
  }

  console.log('')
  log.info('Astrale bootstrap\n')
  for (const r of reports) {
    const label = r.domain.padEnd(11)
    if (r.state === 'already-installed') {
      log.info(`${label} already installed, skipped (${r.origin})`)
    } else if (r.state === 'installed') {
      log.success(`${label} installed (${r.origin})`)
    } else {
      log.warn(`${label} installed (${r.origin}) — worker not reachable at ${r.workerUrl}`)
      log.dim('  The console will not load until that worker is up.')
    }
  }
}

export default {
  name: 'bootstrap',
  description: 'Install the builtin distribution + manager-ui domains onto the manager',
  afterHelpText: `
Behavior:
  Installs onto the MANAGER kernel itself (not the active instance) — there
  is no -i/--instance flag. Idempotent: a domain whose Domain node already
  exists is skipped ("already installed"). Schema-only: no grants and no
  Distribution.init run on the manager (manager-ui has no methods;
  distribution-on-manager only provides the View class). If the manager-ui
  worker is down the spec still installs but the console will not load until
  the worker is up. To force a clean reinstall: astrale reset, then re-run.

Examples:
  $ astrale start && astrale bootstrap
  $ astrale bootstrap --only manager-ui --skip-worker-check
  $ astrale bootstrap --as alice --raw
`,
  options: [
    {
      flags: '--only <domain>',
      description: 'Bootstrap only one builtin (distribution|manager-ui)',
    },
    { flags: '--skip-worker-check', description: 'Skip the manager-ui worker reachability probe' },
    { flags: '--as <identity>', description: 'Call as a specific identity' },
    { flags: '--creds <token>', description: 'Use a pre-signed credential' },
    {
      flags: '--format <type>',
      description: 'Output format (default: yaml in TTY, json when piped)',
      choices: ['yaml', 'json'],
    },
    ...RAW_OUTPUT_OPTIONS,
  ],
  action: async (opts) => {
    await bootstrapCommand(opts as BootstrapOpts)
  },
} satisfies CommandDefinition
