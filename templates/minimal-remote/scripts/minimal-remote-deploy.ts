#!/usr/bin/env bun
import { domainUrl } from '@astrale-os/kernel-test'
/**
 * Deploy the minimal-remote worker and verify the drift contract inline.
 *
 * Mirrors distribution/scripts/distribution-deploy.ts — see its comments
 * for the why of each stamping step.
 */
import { deployCheck, hashSpecFile } from '@astrale-os/sdk/deploy'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { domainEnvs } from '../envs.ts'

const skipDriftCheck = process.argv.includes('--skip-drift-check')

const here = dirname(fileURLToPath(import.meta.url))
const domainRoot = join(here, '..')
const workerDir = join(domainRoot, 'worker')
const sdkDir = join(domainRoot, '..', '..', '..', 'sdk')
const specPath = join(domainRoot, 'spec.json')

const sdkCommit = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
  cwd: sdkDir,
  encoding: 'utf-8',
}).stdout.trim()
if (!sdkCommit) {
  console.error(`Cannot read sdk/ HEAD at ${sdkDir}`)
  process.exit(1)
}

const buildSpecRes = spawnSync('bun', ['run', 'scripts/build-spec.ts', '--domain', 'prod'], {
  cwd: domainRoot,
  stdio: 'inherit',
})
if (buildSpecRes.status !== 0) process.exit(buildSpecRes.status ?? 1)
if (!existsSync(specPath)) {
  console.error(`spec.json missing at ${specPath} after build:spec`)
  process.exit(1)
}
const schemaHash = hashSpecFile(specPath)

console.log(`Deploying worker`)
console.log(`  SDK_COMMIT  = ${sdkCommit}`)
console.log(`  SCHEMA_HASH = ${schemaHash}`)

const deployRes = spawnSync(
  'bunx',
  [
    'wrangler',
    'deploy',
    '--define',
    `SDK_COMMIT:"${sdkCommit}"`,
    '--define',
    `SCHEMA_HASH:"${schemaHash}"`,
  ],
  { cwd: workerDir, stdio: 'inherit' },
)
if (deployRes.status !== 0) process.exit(deployRes.status ?? 1)

const prodUrl = domainUrl(domainEnvs.prod())
if (skipDriftCheck) {
  console.log(`• post-deploy drift check skipped (--skip-drift-check)`)
  console.log(`  zone: ${prodUrl}`)
  console.log(`  if DNS isn't provisioned yet, smoke-test on *.workers.dev instead`)
  process.exit(0)
}
try {
  await deployCheck({ url: prodUrl, expectedSchemaHash: schemaHash, sdkRepoPath: sdkDir })
  console.log(`✓ ${prodUrl} live and consistent with local state`)
} catch (e) {
  const msg = (e as Error).message
  const looksLikeDnsOrNetwork =
    /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|abort|fetch failed|getaddrinfo|Host not found|\b52[0-4]\b/i.test(
      msg,
    )
  if (looksLikeDnsOrNetwork) {
    console.warn(`⚠ post-deploy check skipped: ${prodUrl} unreachable`)
    console.warn(`  reason: ${msg}`)
    console.warn(`  hint : DNS for this zone may not be provisioned yet.`)
    console.warn(`         Smoke-test on the *.workers.dev URL printed by wrangler above,`)
    console.warn(`         or rerun once DNS routes are live.`)
    process.exit(0)
  }
  console.error(`✗ post-deploy drift check failed: ${msg}`)
  console.error(`  (schemaHash or sdkCommit mismatch — your local state doesn't match the worker).`)
  console.error(`  Use --skip-drift-check only for first-time deploys before DNS is live.`)
  process.exit(1)
}
