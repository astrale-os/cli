#!/usr/bin/env bun
/**
 * `build:spec --domain <preset>` — stamp `spec.json` for a domain preset.
 * Single source of truth: no `.env` fallback, no inline overrides.
 *
 * Usage:
 *   pnpm build:spec --domain local:inprocess
 *   pnpm build:spec --domain local:tunneled
 *   pnpm build:spec --domain prod
 */
import { domainUrl } from '@astrale-os/kernel-test'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { domainEnvs } from '../envs.ts'
import { evalPreset } from './lib.ts'

const here = dirname(fileURLToPath(import.meta.url))
const domainRoot = join(here, '..')

const args = process.argv.slice(2)
const domainName = flag('--domain')
if (!domainName) {
  console.error(
    'Usage: build-spec.ts --domain <preset>\n' + `  domain: ${Object.keys(domainEnvs).join(' | ')}`,
  )
  process.exit(1)
}

const domain = evalPreset(domainEnvs, domainName, 'domain')
process.env.MINIMAL_BASE_DOMAIN = domain.domain
process.env.MINIMAL_WORKER_URL = domainUrl(domain)

const buildCli = join(domainRoot, '..', '..', '..', 'sdk', 'src', 'domain', 'build-spec-cli.ts')
const domainModule = join(domainRoot, 'domain.ts')
const outputPath = join(domainRoot, 'spec.json')

const result = spawnSync('bun', ['run', buildCli, domainModule, outputPath], {
  stdio: 'inherit',
  env: process.env,
})
process.exit(result.status ?? 1)

function flag(name: string): string | undefined {
  const i = args.indexOf(name)
  if (i < 0) return undefined
  return args[i + 1]
}
