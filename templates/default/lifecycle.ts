/**
 * Per-domain lifecycle — consumed by `astrale domain dev up/down`.
 *
 * `extraDevVars` are STATIC literals, snapshotted when the CLI imports this
 * module — *before* the `preUp` hook runs. So a value loaded from a `.env`
 * MUST go through `forwardEnv` / `forwardEnvOptional` (which the CLI
 * resolves from `process.env` AFTER `preUp`), never `extraDevVars`.
 *
 * The `preUp` hook below loads `<domainDir>/.env` into `process.env`, so
 * runtime secrets are picked up without a manual `source .env` — from any
 * cwd, including the multi-domain `dev up` fan-out (it uses the absolute
 * `ctx.domainDir`, not the process cwd).
 */

import type { LifecycleConfig, LifecycleHook, LifecycleHooks } from '@astrale-os/kernel-host'

import { join } from 'node:path'

import { loadEnv } from './load-env'

export const config: LifecycleConfig = {
  // Static literal — `DISTRIBUTION_BASE_DOMAIN` points the imported
  // `DistributionSchema` (`View` / `RemoteFunction`) at the local install.
  extraDevVars: {
    DISTRIBUTION_BASE_DOMAIN: 'dist.localhost',
  },

  // Runtime secrets: declare them here (resolved from `process.env` AFTER
  // the preUp hook loads `.env`). `dev up` fails fast if a `requiredSecrets`
  // entry is unset. Uncomment + rename for your domain:
  //
  // requiredSecrets: ['MY_API_KEY'],
  // forwardEnv: ['MY_API_KEY'],
  // forwardEnvOptional: ['MY_OPTIONAL_KEY'],
}

// Loads `<domainDir>/.env` before the CLI reads secrets. Absolute
// `ctx.domainDir` ⇒ works regardless of cwd (incl. the fan-out).
const loadDomainEnv: LifecycleHook = (ctx) => {
  loadEnv(join(ctx.domainDir, '.env'))
}

export const hooks: LifecycleHooks = {
  preUp: loadDomainEnv,
  preDown: loadDomainEnv,
}
