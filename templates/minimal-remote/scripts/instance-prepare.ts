#!/usr/bin/env bun
/**
 * `instance:prepare` — rebuild spec + register + boot + install + mint
 * against the locally-running astrale manager. Stripped-down sibling of
 * distribution/scripts/instance-prepare.ts.
 *
 *   bun run scripts/instance-prepare.ts --kernel <k> --domain <d> [--instance <id>]
 *
 * Emits a shell-exportable env block on stdout (INSTANCE / DOMAIN /
 * DOMAIN_URL / WORKER_URL / CONTROL_URL / ISS / PARENT / TOKEN).
 */
import { domainUrl, schemeOf } from '@astrale-os/kernel-test'
import { kernelEnvs, type KernelEnvName } from '@astrale-os/kernel-toolkit'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { domainEnvs, type DomainEnvName } from '../envs.ts'
import { evalPreset, isAstraleRunning } from './lib.ts'

const here = dirname(fileURLToPath(import.meta.url))
const domainRoot = join(here, '..')

const args = parseArgs(process.argv.slice(2))
if (!args.kernel || !args.domain) usage()
const kernelName = args.kernel as KernelEnvName
const domainName = args.domain as DomainEnvName

const instanceId = args.instance ?? 'test'
const kernel = evalPreset(kernelEnvs, kernelName, 'kernel')
const domain = evalPreset(domainEnvs, domainName, 'domain')

validateSlug(domain.domain)

if (kernel.mode === 'standalone') {
  console.error(
    `# standalone kernel → instance:prepare is a no-op.\n` +
      `# The e2e test fixture installs the domain itself. Just run:\n` +
      `#   MINIMAL_KERNEL=${kernelName} MINIMAL_DOMAIN=${domainName} pnpm test\n`,
  )
  process.stdout.write(
    `INSTANCE=\nDOMAIN=${domain.domain}\n` +
      `DOMAIN_URL=${domainUrl(domain)}\nWORKER_URL=${domainUrl(domain)}\n` +
      `CONTROL_URL=${schemeOf(kernel.kernelDomain)}://${kernel.kernelDomain}\n` +
      `ISS=${schemeOf(kernel.kernelDomain)}://${kernel.kernelDomain}\nPARENT=\nTOKEN=\n`,
  )
  process.exit(0)
}

if (!isAstraleRunning()) {
  console.error(
    `✗ astrale manager is not running.\n` +
      `  Start it with: astrale start\n` +
      `  Or run: pnpm infra:prepare --kernel ${kernelName} --domain ${domainName}`,
  )
  process.exit(1)
}

const aud = domain.domain
const domainUrlStr = domainUrl(domain)

console.error(`# rebuild spec (domain=${domainName})`)
const build = spawnSync('bun', ['run', 'scripts/build-spec.ts', '--domain', domainName], {
  cwd: domainRoot,
  env: process.env,
  stdio: ['inherit', 2, 'inherit'],
})
if (build.status !== 0) die('build:spec failed')

const controlUrl = `${schemeOf(kernel.managerDomain)}://${kernel.managerDomain}`

if (kernel.instanceDomain) {
  const pinnedId = kernel.instanceDomain.includes('/')
    ? (kernel.instanceDomain.split('/').pop() ?? '')
    : (kernel.instanceDomain.split('.')[0] ?? '')
  if (pinnedId && pinnedId !== instanceId) {
    console.error(
      `✗ instance id "${instanceId}" mismatches instanceDomain hint "${kernel.instanceDomain}"\n` +
        `  (it identifies instance "${pinnedId}").\n` +
        `  Either pass --instance ${pinnedId}, or reconfigure the tunnel for "${instanceId}".`,
    )
    process.exit(1)
  }
}

const hint = kernel.instanceDomain
  ? `${schemeOf(kernel.instanceDomain)}://${kernel.instanceDomain}`
  : `${controlUrl}/${instanceId}`
console.error(`# manager: controlUrl=${controlUrl} hint=${hint}`)

runCli(['instance', 'delete', instanceId, '--force'], { allowFail: true })
runCli(['instance', 'create', instanceId, '--local', '--issuer', hint, '--skip-jwks-check'])

const iss = await waitForInstanceReady(instanceId, hint)
console.error(`# manager: iss (authoritative) = ${iss}`)

runCli([
  'domain',
  'install',
  join(domainRoot, 'spec.json'),
  '-i',
  instanceId,
  // The scaffold has no pre-minted admin key — the manager's own system
  // credential signs the install. If your domain needs a dedicated admin
  // key, generate one with `astrale identity create` and pass --key here.
])

const parent = `/${domain.domain}`
const token = runCli(['token', '--audience', aud, '--ttl', '3600', '--instance', instanceId], {
  capture: true,
}).trim()

process.stdout.write(
  `INSTANCE=${instanceId}\n` +
    `DOMAIN=${domain.domain}\n` +
    `DOMAIN_URL=${domainUrlStr}\n` +
    `WORKER_URL=${domainUrlStr}\n` +
    `CONTROL_URL=${controlUrl}\n` +
    `ISS=${iss}\n` +
    `PARENT=${parent}\n` +
    `TOKEN=${token}\n`,
)

function parseArgs(argv: string[]): { kernel?: string; domain?: string; instance?: string } {
  const out: { kernel?: string; domain?: string; instance?: string } = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--kernel') out.kernel = argv[++i]
    else if (argv[i] === '--domain') out.domain = argv[++i]
    else if (argv[i] === '--instance') out.instance = argv[++i]
  }
  return out
}

function runCli(args: string[], opts: { allowFail?: boolean; capture?: boolean } = {}): string {
  const r = spawnSync('astrale', args, {
    cwd: domainRoot,
    env: process.env,
    encoding: 'utf-8',
    stdio: opts.capture ? ['inherit', 'pipe', 'inherit'] : ['inherit', 2, 'inherit'],
  })
  if (r.status !== 0 && !opts.allowFail) {
    console.error(`astrale ${args.join(' ')} failed (exit ${r.status})`)
    process.exit(r.status ?? 1)
  }
  return opts.capture ? r.stdout : ''
}

async function waitForInstanceReady(id: string, fallbackIss: string): Promise<string> {
  console.error(`# waitForInstanceReady (astrale instance status ${id} --raw)`)
  const deadline = Date.now() + 30_000
  let lastIss = fallbackIss
  while (Date.now() < deadline) {
    const r = spawnSync('astrale', ['instance', 'status', id, '--raw'], {
      encoding: 'utf-8',
      stdio: ['inherit', 'pipe', 'inherit'],
    })
    if (r.status === 0 && r.stdout.trim()) {
      try {
        const info = JSON.parse(r.stdout) as { issuer?: unknown; keys?: unknown }
        if (typeof info.issuer === 'string') lastIss = info.issuer
        if (Array.isArray(info.keys) && info.keys.length > 0) return lastIss
      } catch {
        // keep polling
      }
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  console.error(
    `✗ instance "${id}" not ready within 30s — JWKS unreachable; check tunnel + Transform Rule (see deploy.md / identity-model.md)`,
  )
  process.exit(1)
}

function validateSlug(slug: string): void {
  if (/[^a-zA-Z0-9.\-_]/.test(slug)) {
    console.error(
      `✗ domain slug "${slug}" is not path-safe.\n` +
        `  schema.domain is used as a path prefix; encode ports via DomainEnv.port.`,
    )
    process.exit(1)
  }
}

function usage(): never {
  console.error(
    'Usage: instance-prepare.ts --kernel <kernel-preset> --domain <domain-preset> [--instance <id>]\n' +
      `  kernel: ${Object.keys(kernelEnvs).join(' | ')}\n` +
      `  domain: ${Object.keys(domainEnvs).join(' | ')}`,
  )
  process.exit(1)
}

function die(msg: string): never {
  console.error(`✗ ${msg}`)
  process.exit(1)
}
