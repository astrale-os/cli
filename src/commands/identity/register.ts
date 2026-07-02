import { importJWK, SignJWT, type JWK } from 'jose'
import { readFile } from 'node:fs/promises'

import type { CommandDefinition } from '../../command'
import type { ClientContext, KernelCommandOpts } from '../../kernel'

import { bindGraph, runKernelCommand } from '../../kernel'
import { KERNEL_PASSTHROUGH_OPTIONS } from '../../kernel/options'
import { getIdentity, setRegistration } from '../../lib/identity'
import { getActive } from '../../lib/instance'
import { fileExists, keypairPaths } from '../../lib/keys'
import { fatal, log } from '../../lib/log'
import { output } from '../../lib/output'

type RegisterIdentityResult = { iss: string; sub: string }

type RegisterOpts = KernelCommandOpts & {
  class?: string
  path?: string
  props?: string
}

async function readJwk(path: string): Promise<JWK> {
  const raw = await readFile(path, 'utf-8')
  return JSON.parse(raw) as JWK
}

/**
 * Discover the identity-bearer class on the target instance: find the
 * installed domain that owns a `User` class (workspace on managed instances)
 * and address it semantically.
 * The bearer class must exist before a non-root identity can be registered;
 * failing here names the real problem instead of surfacing as a confusing
 * permission error on a hardcoded origin.
 */
async function resolveUserClassPath(ctx: ClientContext): Promise<string> {
  const graph = bindGraph(ctx)
  // Root's direct children are the installed Domain nodes (function.get depth:1).
  const { nodes } = await graph.children('/')
  const domains = nodes
    .filter((n) => typeof n.class === 'string' && n.class.endsWith(':class.Domain'))
    .map((n) => (n.path ?? '').replace(/^\//, ''))
    .filter(Boolean)
  for (const origin of domains) {
    // The class materializes as a `class.User` Folder under the domain mount;
    // a visible node means the domain declares it (soft-root: null when absent).
    if (await graph.node(`/${origin}/class.User`)) {
      return `/:${origin}:class.User`
    }
  }
  throw new Error(
    'No installed domain declares a `User` class on this instance — registering a ' +
      'non-root identity needs an identity-bearer class (install workspace or another ' +
      'domain, or pass --class <classPath> explicitly).',
  )
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
    'key under a thumbprint-derived issuer and caches the resolved (iss, sub) for future calls',
  arguments: [{ name: 'name', description: 'Identity name', required: true }],
  options: [
    {
      flags: '--class <classPath>',
      description:
        'Class path of the identity node to create (default: the installed domain that declares class.User)',
    },
    {
      flags: '--path <nodePath>',
      description: 'Path of the new identity node (default: /workspace/users/<name>)',
    },
    {
      flags: '--props <json>',
      description:
        'Extra props for the identity node (JSON). A User-class node defaults ' +
        'firstName/lastName to the identity name when omitted.',
    },
    ...KERNEL_PASSTHROUGH_OPTIONS,
  ],
  action: async (name: string, opts: RegisterOpts) => {
    try {
      const identity = await getIdentity(name)
      const { privatePath, publicPath } = keypairPaths(identity.subject)
      if (!(await fileExists(privatePath)) || !(await fileExists(publicPath))) {
        fatal(
          new Error(
            `No keypair on disk for "${name}" (expected ${privatePath}). Recreate via \`astrale identity create ${name}\`.`,
          ),
        )
      }
      const privateJwk = await readJwk(privatePath)
      const publicJwk = await readJwk(publicPath)
      const nodePath = opts.path ?? `/workspace/users/${name}`

      await runKernelCommand({
        opts,
        label: `Register "${name}"`,
        fn: async (ctx) => {
          const instanceSlug = opts.instance ?? opts.url ?? (await getActive(ctx.config)).name
          const existing = identity.registrations?.[instanceSlug]
          if (existing) {
            log.warn(`"${name}" already registered on "${instanceSlug}"`)
            return existing
          }

          const classPath = opts.class ?? (await resolveUserClassPath(ctx))

          // A bare `astrale identity create <name>` carries no profile, but a
          // User bearer class may require one. Default both names so a dev
          // registration works out of the box; `--props` overrides.
          const extraProps = opts.props ? (JSON.parse(opts.props) as Record<string, unknown>) : {}
          const userDefaults = classPath.endsWith(':class.User')
            ? { firstName: name, lastName: name }
            : {}

          // One-arm create through function.mutate; the minted node id comes
          // back in createdNodes (keyed by the `at` path).
          const nodeId = await bindGraph(ctx).create(classPath, nodePath, {
            'Statused.status': 'creating',
            ...userDefaults,
            ...extraProps,
          })

          const bootstrap = await mintBootstrapJwt(privateJwk)
          const result = (await ctx.client.call(`@${nodeId}::registerIdentity`, {
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
