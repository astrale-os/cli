import { KernelClient, type FnMap } from '@astrale-os/kernel-client'

import type { CommandDefinition } from '../../command'

import { resolveCredential } from '../../kernel/auth'
import { resolveBuiltinDomain } from '../../lib/builtin-domains'
import { readConfig } from '../../lib/config'
import { grantDistributionBootstrap } from '../../lib/grants'
import { getDefault } from '../../lib/identity'
import { addInstance, managerUrl } from '../../lib/instance'
import { resolveAuth } from '../../lib/keys'
import { fatal, fatalNotImplemented, log } from '../../lib/log'
import { checkIssuerReachability } from '../../lib/meta'
import { KEYS_DIR } from '../../lib/paths'
import { bindTunnel, findTunnel, readTunnels } from '../../lib/tunnels'
import { validateSlug } from '../../lib/validation'
import instanceInstall from './install'

function extractDomainOrigin(spec: {
  nodes?: Array<{ class?: unknown; props?: { origin?: unknown } }>
}): string | undefined {
  for (const node of spec.nodes ?? []) {
    const rawCls = (node as { class?: unknown }).class
    const clsStr =
      typeof rawCls === 'string'
        ? rawCls
        : rawCls && typeof rawCls === 'object' && 'raw' in rawCls
          ? String((rawCls as { raw: string }).raw)
          : undefined
    if (!clsStr?.startsWith('/:kernel.astrale.ai:class.Domain')) continue
    const origin = node.props?.origin
    if (typeof origin === 'string') return origin
  }
  return undefined
}

async function rollback(client: KernelClient<FnMap>, credential: string, slug: string) {
  try {
    await client.call('/manager.astrale.ai/class.KernelInstance/delete', { id: slug }, credential)
    log.dim(`  rolled back — "${slug}" deleted on manager`)
  } catch {
    /* best effort */
  }
}

export default {
  name: 'create',
  description:
    'Create an instance (managed cloud by default, §4.2 — or local child with --local, §4.3)',
  arguments: [
    { name: 'name', description: 'Instance slug (local) or display name (cloud)', required: true },
  ],
  options: [
    { flags: '--local', description: 'Target the local manager (§4.3)' },
    { flags: '--name <display>', description: 'Human-readable label (local child)' },
    {
      flags: '--config <name>',
      description: 'Named instance config (built-in or user-defined, §4.5)',
    },
    { flags: '--tunnel <id>', description: 'Bind a machine tunnel (§4.6 tunneled mode)' },
    { flags: '--as <identity>', description: 'Identity to record as default (§2.4)' },
    {
      flags: '--distroless',
      description:
        'Do not install the builtin distribution domain (users, desktops, views, compute) on the new instance',
    },
    {
      flags: '--install <domain-spec>',
      description: 'Install a domain spec (path or builtin name) after boot (§9)',
    },
    {
      flags: '-k, --key <path>',
      description: 'JWK private key file for the install identity (with --install)',
    },
    {
      flags: '--skip-jwks-check',
      description: 'Skip the post-create JWKS reachability check (§4.6)',
    },
    {
      flags: '--issuer <url>',
      description:
        'Override the baked issuer (escape hatch for path-based tunnels where the auto-derived `https://<tunnel>/<slug>` form is needed)',
    },
  ],
  action: async (
    slug: string,
    opts: {
      local?: boolean
      name?: string
      config?: string
      tunnel?: string
      as?: string
      distroless?: boolean
      install?: string
      key?: string
      skipJwksCheck?: boolean
      issuer?: string
    },
  ) => {
    try {
      if (!opts.local) {
        fatalNotImplemented(
          'astrale instance create (managed cloud)',
          'Use `--local <slug>` for the local-child path, or wait for the cloud adapter (§15).',
        )
      }
      validateSlug(slug)

      // §12 — tunnel bind resolved before boot; baked issuer depends on it.
      let tunnelHostname: string | undefined
      if (opts.tunnel) {
        const store = await readTunnels()
        const t = findTunnel(store, opts.tunnel)
        if (!t) {
          fatal(
            new Error(
              `Tunnel "${opts.tunnel}" not registered. Run: astrale tunnel setup ${opts.tunnel}`,
            ),
          )
        }
        if (t!.boundInstance && t!.boundInstance !== slug) {
          fatal(
            new Error(`Tunnel "${opts.tunnel}" already bound to "${t!.boundInstance}" (1:1, §12)`),
          )
        }
        tunnelHostname = t!.hostname
      }

      const config = await readConfig()
      const url0 = managerUrl(config)
      const credential = await resolveCredential({}, config)
      const client = new KernelClient<FnMap>({ url: url0, requestTimeout: 10_000 })

      // Default child issuer/url for local-proxied mode (§4.6).
      // Children are mounted at `http://localhost:<port>/<slug>/` — NOT under
      // `/mngt/` (which is the manager-only prefix, §3.2).
      //
      // `--issuer` overrides the auto-derived form. Needed for path-based
      // tunnel topologies (one tunnel hostname fronting N instances via
      // path-prefix routing) where the auto form `https://<hostname>` would
      // miss the `/<slug>` suffix the ingress rewrites on.
      const defaultChildUrl = `http://localhost:${config.managerPort}/${slug}`
      const autoBakedIssuer = tunnelHostname ? `https://${tunnelHostname}` : defaultChildUrl
      if (opts.issuer !== undefined) {
        try {
          void new URL(opts.issuer)
        } catch {
          fatal(new Error(`Invalid --issuer URL: "${opts.issuer}"`))
        }
      }
      const bakedIssuer = opts.issuer ?? autoBakedIssuer

      // Pre-generate a per-instance keypair. The manager reads the public
      // key off the register payload and persists it on the KernelInstance
      // node; the spawn callback loads the matching private key from disk
      // to build the child's AuthBinding. The CLI itself signs calls that
      // target this instance with the same private key, so tokens present
      // `{iss=bakedIssuer, sub=slug}` — which the child recognizes as its
      // own identity (see authenticator.ts `resolveIdentity` shortcut).
      const instanceAuth = await resolveAuth(KEYS_DIR, {
        issuer: bakedIssuer,
        subject: slug,
      })

      let registered = false
      try {
        log.info(`Registering instance "${slug}" on manager…`)
        await client.call(
          '/manager.astrale.ai/class.KernelInstance/register',
          {
            id: slug,
            graphName: `${slug}-graph`,
            host: 'localhost',
            port: config.falkorPort,
            issuer: bakedIssuer,
            label: opts.name,
            publicKey: instanceAuth.publicKey,
          },
          credential,
        )
        registered = true
        log.info(`Booting "${slug}"…`)
        await client.call('/manager.astrale.ai/class.KernelInstance/boot', { id: slug }, credential)

        const info = (await client.call(
          '/manager.astrale.ai/class.KernelInstance/info',
          { id: slug },
          credential,
        )) as { issuer?: string; url?: string }
        const issuer = info.issuer ?? bakedIssuer
        const url = info.url ?? issuer

        // §4.6 invariant — failed JWKS check invalidates the baked issuer.
        if (!opts.skipJwksCheck) {
          try {
            const { keys } = await checkIssuerReachability(url, issuer)
            log.dim(
              `  OIDC discovery + JWKS ok (${keys.length} key${keys.length === 1 ? '' : 's'})`,
            )
          } catch (e) {
            log.error(`post-create JWKS check failed: ${(e as Error).message}`)
            log.dim('  rolling back — issuer has no rescue path (§4.6).')
            await rollback(client, credential, slug)
            registered = false
            process.exit(1)
          }
        }

        const defaultIdentity = opts.as ?? (await getDefault()).name
        log.dim(`  default identity: ${defaultIdentity}`)

        // `url`, `issuer`, `createdAt` live on the manager (`KernelInstance` node)
        // and are resolved via `resolveInstance` when needed. Only CLI-local
        // state goes in `instances.json`.
        await addInstance(slug, {
          slug,
          name: opts.name,
          kind: 'local-child',
          mode: 'local',
          defaultIdentity,
        })

        if (opts.tunnel) {
          await bindTunnel(opts.tunnel, slug)
          log.dim(`  tunnel bound: ${opts.tunnel} → ${slug}`)
        }

        log.success(`Created local instance "${slug}"${opts.name ? ` (${opts.name})` : ''}`)
        log.dim(`  url=${url}`)

        if (opts.install) {
          log.info(`Installing domain spec "${opts.install}" on "${slug}"…`)
          await instanceInstall.action(opts.install, {
            instance: slug,
            key: opts.key,
          } as Parameters<typeof instanceInstall.action>[1])
        }

        if (!opts.distroless) {
          const builtin = await resolveBuiltinDomain('distribution')
          log.info(`Installing builtin distribution domain on "${slug}"…`)
          await instanceInstall.action(builtin.specPath, {
            instance: slug,
            key: builtin.keyPath,
          } as Parameters<typeof instanceInstall.action>[1])

          // Derive origin from the installed spec (read directly, no probe).
          const spec = JSON.parse(
            await (await import('node:fs/promises')).readFile(builtin.specPath, 'utf-8'),
          ) as {
            nodes?: Array<{ class?: unknown; props?: { origin?: unknown } }>
          }
          const origin = extractDomainOrigin(spec) ?? 'dist.astrale.ai'

          const instanceClient = new KernelClient<FnMap>({ url, requestTimeout: 10_000 })
          const instanceCredential = await resolveCredential({}, config, url, slug)
          try {
            await grantDistributionBootstrap(instanceClient, instanceCredential, origin)
            log.success(`Distribution ready on "${slug}" (origin=${origin})`)
            log.dim('  Note: --as admin enrollment requires per-identity keys (§2.4 v2).')
          } finally {
            instanceClient.disconnect()
          }
        }
      } catch (err) {
        if (registered) await rollback(client, credential, slug)
        throw err
      } finally {
        client.disconnect()
      }
    } catch (e) {
      fatal(e)
    }
  },
} satisfies CommandDefinition
