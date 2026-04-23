/**
 * Vitest setupFile — loads `.env` (if present), validates the preset env
 * vars, and sets MINIMAL_BASE_DOMAIN from the selected domain preset so
 * schema/schema.ts reads the right slug at module-load time.
 *
 * Unlike distribution's setup-env, the scaffold tolerates missing
 * MINIMAL_KERNEL / MINIMAL_DOMAIN — they default to an in-process fixture
 * pair so `pnpm test` works with zero configuration.
 */
import { kernelEnvs } from '@astrale-os/kernel-toolkit'

import { domainEnvs, type DomainEnvName } from '../envs.ts'

const kernelName = process.env.MINIMAL_KERNEL ?? 'local:standalone:inprocess'
const domainName = process.env.MINIMAL_DOMAIN ?? 'local:inprocess'

if (!(kernelName in kernelEnvs)) {
  throw new Error(
    `MINIMAL_KERNEL="${kernelName}" is not a valid preset. ` +
      `Valid: ${Object.keys(kernelEnvs).join(' | ')}`,
  )
}
if (!(domainName in domainEnvs)) {
  throw new Error(
    `MINIMAL_DOMAIN="${domainName}" is not a valid preset. ` +
      `Valid: ${Object.keys(domainEnvs).join(' | ')}`,
  )
}

process.env.MINIMAL_KERNEL = kernelName
process.env.MINIMAL_DOMAIN = domainName
process.env.MINIMAL_BASE_DOMAIN = domainEnvs[domainName as DomainEnvName]().domain
