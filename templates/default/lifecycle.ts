/**
 * Per-domain lifecycle hooks.
 *
 * `astrale domain dev up` reads `config.extraDevVars` and writes them into
 * the worker's `.dev.vars`. We expose `DISTRIBUTION_BASE_DOMAIN` so the
 * imported `DistributionSchema` (used by `View` / `RemoteFunction`) resolves
 * to the local installation's origin at runtime instead of the prod default.
 *
 * Override via shell env or `.env.local` when targeting a different
 * distribution install. For required secrets, switch to
 * `requiredSecrets: [...]` here and run `astrale domain dev up` — it fails
 * fast with a clear message when any are missing.
 */

import type { LifecycleConfig } from '@astrale-os/kernel-host'

export const config: LifecycleConfig = {
  extraDevVars: {
    DISTRIBUTION_BASE_DOMAIN: 'dist.localhost',
  },
}
