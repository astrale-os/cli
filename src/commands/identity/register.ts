import { importJWK, SignJWT, type JWK } from 'jose'
import { readFile } from 'node:fs/promises'

import type { CommandDefinition } from '../../command'
import type { KernelCommandOpts } from '../../kernel'

import { runKernelCommand } from '../../kernel'
import { KERNEL_PASSTHROUGH_OPTIONS } from '../../kernel/options'
import { resolveBuiltinDomain } from '../../lib/builtin-domains'
import { getIdentity, setRegistration } from '../../lib/identity'
import { fileExists, keypairPaths } from '../../lib/keys'
import { fatal, log } from '../../lib/log'
import { output } from '../../lib/output'
import { KEYS_DIR } from '../../lib/paths'

const KERNEL_NODE_CREATE = '/kernel.astrale.ai/interface.Node/createNode'

type CreateNodeResult = { id: string; path: string }
type RegisterIdentityResult = { iss: string; sub: string }

type RegisterOpts = KernelCommandOpts & {
  class?: string
  path?: string
}

async function readJwk(path: string): Promise<JWK> {
  const raw = await readFile(path, 'utf-8')
  return JSON.parse(raw) as JWK
}

async function defaultClassPath(): Promise<string> {
  // Default to the distribution domain's User class — distribution is
  // installed by `astrale instance create` unless `--distroless`. Resolve
  // the origin from the builtin spec so we follow the actual install
  // (dist.localhost in dev, dist.astrale.ai canonically) rather than
  // hard-coding either.
  const builtin = await resolveBuiltinDomain('distribution')
  const raw = await readFile(builtin.specPath, 'utf-8')
  const spec = JSON.parse(raw) as {
    nodes?: Array<{ class?: { raw?: string } | string; props?: { origin?: unknown } }>
  }
  for (const node of spec.nodes ?? []) {
    const cls = typeof node.class === 'string' ? node.class : node.class?.raw
    if (
      cls?.startsWith('/:kernel.astrale.ai:class.Domain') &&
      typeof node.props?.origin === 'string'
    ) {
      return `/:${node.props.origin}:class.User`
    }
  }
  return '/:dist.localhost:class.User'
}

async function mintBootstrapJwt(privateJwk: JWK): Promise<string> {
  const kid = (privateJwk.kid as string | undefined) ?? 'bootstrap'
  const key = await importJWK(privateJwk, 'ES256')
  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid })
    .setIssuer('self')
    .setSubject('bootstrap')
    .setAudience('bootstrap')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(key)
}

export default {
  name: 'register',
  description:
    "Register a local identity with the target instance's kernel — publishes the public " +
    'key under a thumbprint-derived issuer and caches the resolved (iss, sub) for future calls (DESIGN.md §6.4 Path B)',
  arguments: [{ name: 'name', description: 'Identity name', required: true }],
  options: [
    {
      flags: '--class <classPath>',
      description:
        'Class path of the identity node to create (default: /:dist.<origin>:class.User from the active distribution install)',
    },
    {
      flags: '--path <nodePath>',
      description: 'Path of the new identity node (default: /workspace/users/<name>)',
    },
    ...KERNEL_PASSTHROUGH_OPTIONS,
  ],
  action: async (name: string, opts: RegisterOpts) => {
    try {
      const identity = await getIdentity(name)
      const { privatePath, publicPath } = keypairPaths(identity.subject, KEYS_DIR)
      if (!(await fileExists(privatePath)) || !(await fileExists(publicPath))) {
        fatal(
          new Error(
            `No keypair on disk for "${name}" (expected ${privatePath}). Recreate via \`astrale identity create ${name}\`.`,
          ),
        )
      }
      const privateJwk = await readJwk(privatePath)
      const publicJwk = await readJwk(publicPath)
      const classPath = opts.class ?? (await defaultClassPath())
      const nodePath = opts.path ?? `/workspace/users/${name}`

      await runKernelCommand({
        opts,
        label: `Register "${name}"`,
        fn: async (ctx) => {
          const instanceSlug = opts.instance ?? 'manager'
          const existing = identity.registrations?.[instanceSlug]
          if (existing) {
            log.warn(`"${name}" already registered on "${instanceSlug}"`)
            return existing
          }

          const node = (await ctx.client.call(KERNEL_NODE_CREATE, {
            class: classPath,
            path: nodePath,
            properties: { 'Statused.status': 'creating' },
          })) as CreateNodeResult

          const bootstrap = await mintBootstrapJwt(privateJwk)
          const result = (await ctx.client.call(`@${node.id}::registerIdentity`, {
            signingKey: {
              publicKey: { jwk: publicJwk },
              credential: bootstrap,
            },
          })) as RegisterIdentityResult

          await setRegistration(name, instanceSlug, {
            iss: result.iss,
            sub: result.sub,
            registeredAt: new Date().toISOString(),
          })
          return result
        },
        format: (result, fmtOpts) => {
          output(result, fmtOpts)
          log.dim(`  iss=${result.iss}`)
          log.dim(`  sub=${result.sub}`)
        },
      })
    } catch (e) {
      fatal(e)
    }
  },
} satisfies CommandDefinition
