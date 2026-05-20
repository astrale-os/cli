/**
 * Vitest setupFile — loads `.env` (if present), validates the preset env
 * vars, and sets ASTRALE_DOMAIN_BASE_DOMAIN from the selected domain preset so
 * schema/schema.ts reads the right slug at module-load time.
 *
 * Unlike distribution's setup-env, the scaffold tolerates missing
 * ASTRALE_DOMAIN_KERNEL / ASTRALE_DOMAIN_DOMAIN — they default to an in-process fixture
 * pair so `pnpm test` works with zero configuration.
 */
import { kernelEnvs } from '@astrale-os/kernel-host'

import { domainEnvs, type DomainEnvName } from '../envs.ts'

const kernelName = process.env.ASTRALE_DOMAIN_KERNEL ?? 'local:standalone:inprocess'
const domainName = process.env.ASTRALE_DOMAIN_DOMAIN ?? 'local:inprocess'

if (!(kernelName in kernelEnvs)) {
  throw new Error(
    `ASTRALE_DOMAIN_KERNEL="${kernelName}" is not a valid preset. ` +
      `Valid: ${Object.keys(kernelEnvs).join(' | ')}`,
  )
}
if (!(domainName in domainEnvs)) {
  throw new Error(
    `ASTRALE_DOMAIN_DOMAIN="${domainName}" is not a valid preset. ` +
      `Valid: ${Object.keys(domainEnvs).join(' | ')}`,
  )
}

process.env.ASTRALE_DOMAIN_KERNEL = kernelName
process.env.ASTRALE_DOMAIN_DOMAIN = domainName
process.env.ASTRALE_DOMAIN_BASE_DOMAIN = domainEnvs[domainName as DomainEnvName]().domain

// `DistributionSchema` is imported by schema/schema.ts and throws at module
// load if this is unset. The local installation default mirrors what
// `lifecycle.ts` writes into the worker's `.dev.vars`.
process.env.DISTRIBUTION_BASE_DOMAIN ??= 'dist.localhost'
