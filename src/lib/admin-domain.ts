/**
 * The admin `DomainEntry` surface used by `astrale domain publish`. The merged
 * admin domain models the installable-domain REGISTRY as the `DomainEntry`
 * class (named `DomainEntry`, not `Domain`, because `Domain` is a reserved
 * kernel node-kind); `publish` upserts a `name → url` catalog entry the child
 * kernel later installs from. Publishing only makes a domain INSTALLABLE —
 * mounting it on an instance is the separate `domain install` step (or the
 * admin's install-by-default policy).
 */
export const ADMIN_DOMAIN = '/admin.astrale.ai/class.DomainEntry'

/** Read shape returned by `DomainEntry.publish` / `info` / `list` (domain `DomainInfoSchema`). */
export type DomainInfo = {
  id: string
  /** dist.astrale.ai — the authority origin (== JWT aud + kernel path prefix). */
  origin: string
  /** 'distribution' — the node slug + the id used in install plans / the CLI. */
  name: string
  /** https://dist.astrale.ai — the published worker URL the kernel installs from. */
  url?: string
  description?: string
  installByDefault?: boolean
  createdAt: string
  updatedAt: string
}
