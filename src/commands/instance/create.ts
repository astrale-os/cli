import { type FnMap } from '@astrale-os/kernel-client'
import { ClientSession } from '@astrale-os/kernel-client/session'

import type { CommandDefinition } from '../../command'

import { resolveCredential } from '../../kernel/auth'
import { readConfig } from '../../lib/config'
import { getDefault } from '../../lib/identity'
import { addInstance, managerUrl } from '../../lib/instance'
import { fatal, fatalNotImplemented, log } from '../../lib/log'
import { checkIssuerReachability } from '../../lib/meta'
import { bindTunnel, findTunnel, readTunnels } from '../../lib/tunnels'
import { validateSlug } from '../../lib/validation'
import instanceInstall from './install'

async function rollback(client: ClientSession<FnMap>, slug: string) {
  try {
    await client.call('/manager.astrale.ai/class.KernelInstance/delete', { id: slug })
    log.dim(`  rolled back — "${slug}" deleted on manager`)
  } catch {
    /* best effort */
  }
}

export default {
  name: 'create',
  description: 'Create an instance (managed cloud by default — or local child with --local)',
  arguments: [
    { name: 'name', description: 'Instance slug (local) or display name (cloud)', required: true },
  ],
  options: [
    { flags: '--local', description: 'Target the local manager' },
    { flags: '--name <display>', description: 'Human-readable label (local child)' },
    {
      flags: '--config <name>',
      description: 'Named instance config (built-in or user-defined)',
    },
    { flags: '--tunnel <id>', description: 'Bind a machine tunnel (tunneled mode)' },
    { flags: '--as <identity>', description: 'Identity to record as default' },
    {
      flags: '--distroless',
      description:
        'Do not install the builtin distribution domain (users, desktops, views, compute) on the new instance',
    },
    {
      flags: '--install <domain-spec>',
      description: 'Install a domain spec (path or builtin name) after boot',
    },
    {
      flags: '-k, --key <path>',
      description: 'JWK private key file for the install identity (with --install)',
    },
    {
      flags: '--skip-jwks-check',
      description: 'Skip the post-create JWKS reachability check',
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
          'Use `--local <slug>` for the local-child path, or wait for the cloud adapter.',
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
          fatal(new Error(`Tunnel "${opts.tunnel}" already bound to "${t!.boundInstance}" (1:1)`))
        }
        tunnelHostname = t!.hostname
      }

      const config = await readConfig()
      const url0 = managerUrl(config)
      const credential = await resolveCredential({}, config)
      const client = new ClientSession<FnMap>({
        default: url0,
        identity: credential,
      })

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

      const defaultIdentity = opts.as ?? (await getDefault()).name

      let registered = false
      try {
        log.info(`Creating instance "${slug}" through admin workflow…`)
        const info = (await client.call('/admin.astrale.ai/class.AdminKernelInstance/create', {
          id: slug,
          issuer: bakedIssuer,
          label: opts.name,
          owner: { id: defaultIdentity },
          installDistribution: !opts.distroless,
          seedUser: !opts.distroless,
        })) as { issuer?: string; status?: string }
        registered = true
        const issuer = info.issuer ?? bakedIssuer
        const url = issuer

        // §4.6 invariant — failed JWKS check invalidates the baked issuer.
        if (!opts.skipJwksCheck) {
          try {
            const { keys } = await checkIssuerReachability(url, issuer)
            log.dim(
              `  OIDC discovery + JWKS ok (${keys.length} key${keys.length === 1 ? '' : 's'})`,
            )
          } catch (e) {
            log.error(`post-create JWKS check failed: ${(e as Error).message}`)
            log.dim('  rolling back — issuer has no rescue path.')
            await rollback(client, slug)
            process.exit(1)
          }
        }

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

        // Phase 2 (@self auto-register) is deferred — see TODO below. After
        // `instance create --local`, calling `@self` against the new child
        // refuses with `no-registration`. The seeded-user case can't be fixed
        // by `astrale identity register` either (PATH_CONFLICT on the
        // pre-seeded `/workspace/users/<name>` node) — proper resolution needs
        // either (a) the admin workflow to return the seeded user's nodeId so
        // the CLI writes the registration directly, or (b) the `@self`
        // resolver to lazy-lookup the user node on first use.

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
      } catch (err) {
        if (registered) await rollback(client, slug)
        throw err
      } finally {
        client.disconnect()
      }
    } catch (e) {
      fatal(e)
    }
  },
} satisfies CommandDefinition
