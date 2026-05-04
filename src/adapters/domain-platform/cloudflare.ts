/**
 * Cloudflare DomainPlatform adapter (v1).
 *
 * scaffold(): copies `cli/templates/<template>/` (shipped with the CLI
 *   package) into the target dir, then runs the rename engine and
 *   file-path rename pass.
 *
 * deploy():  runs `buildSpec` → reads `sdk` HEAD + schema hash →
 *   `wrangler deploy --define` → inline `deployCheck` (unless
 *   `--skip-drift-check`). All logic lives in the CLI — domains no
 *   longer ship a per-domain `<slug>-deploy.ts`.
 */

import { deployCheck, hashSpecFile } from '@astrale-os/sdk/deploy'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type {
  DeployOpts,
  DeployResult,
  DomainPlatform,
  ScaffoldOpts,
  ScaffoldResult,
} from '../../ports/domain-platform'

import { AstraleError } from '../../errors'
import {
  buildMinimalRemoteRenameMap,
  copyTemplate,
  pathExists,
  renameFilesInTree,
  rewriteFilesContent,
  slugVariants,
  writeDistClientPlaceholder,
  writeWorkerKeysFile,
} from '../../lib/domain-scaffold'
import { registerWorkspaceMember, type WorkspaceRegistration } from '../../lib/workspace-yaml'
import { domainUrl, loadDomainModule, type DomainEnv } from './cloudflare-helpers'
import {
  buildSpec as lifecycleBuildSpec,
  devDown as lifecycleDevDown,
  devStatus as lifecycleDevStatus,
  devUp as lifecycleDevUp,
  findSdk,
  instancePrepare as lifecycleInstancePrepare,
} from './cloudflare-lifecycle'

const RESERVED_SLUGS = new Set(['minimal', 'minimal-remote'])
const SLUG_RE = /^[a-z][a-z0-9-]{0,38}$/

/**
 * Locate the source dir for a template name. Templates ship with the CLI
 * package under `cli/templates/<template>/`, so resolution is anchored to
 * this file's location via `import.meta.url`. An `ASTRALE_TEMPLATE_ROOT`
 * env var is honored first for dev / testing.
 */
function locateTemplateDir(template: string): string {
  const envOverride = process.env.ASTRALE_TEMPLATE_ROOT
  if (envOverride) {
    const p = join(envOverride, template)
    if (existsSync(p)) return p
  }

  const here = dirname(fileURLToPath(import.meta.url))
  // cli/src/adapters/domain-platform → ../../../ = cli package root
  const cliRoot = resolve(here, '..', '..', '..')
  const templatePath = join(cliRoot, 'templates', template)
  if (existsSync(templatePath)) return templatePath

  throw new AstraleError(
    'TEMPLATE_NOT_FOUND',
    `Template "${template}" not found at ${templatePath}`,
    'Set ASTRALE_TEMPLATE_ROOT to point at a directory containing the template.',
  )
}

export const cloudflareDomainPlatform: DomainPlatform = {
  id: 'cloudflare',

  async scaffold(opts: ScaffoldOpts): Promise<ScaffoldResult> {
    const { slug, template, targetDir, force = false, workspace = false } = opts
    if (!SLUG_RE.test(slug)) {
      throw new AstraleError(
        'INVALID_SLUG',
        `Invalid slug "${slug}"`,
        'Use lowercase kebab-case, 1–39 chars, starting with a letter: [a-z][a-z0-9-]{0,38}',
      )
    }
    if (RESERVED_SLUGS.has(slug)) {
      throw new AstraleError(
        'RESERVED_SLUG',
        `Slug "${slug}" is reserved (used by the scaffold template)`,
        'Pick another slug.',
      )
    }

    const templateDir = locateTemplateDir(template)
    if (!force && (await pathExists(targetDir))) {
      throw new AstraleError(
        'TARGET_EXISTS',
        `Target directory already exists: ${targetDir}`,
        'Pass --force to overwrite, or pick a different --target-dir / slug.',
      )
    }

    await copyTemplate(templateDir, targetDir)
    const renameMap =
      template === 'minimal-remote'
        ? buildMinimalRemoteRenameMap(slug)
        : buildGenericRenameMap(slug)
    const touched = await rewriteFilesContent(targetDir, renameMap)
    const renamed = await renameFilesInTree(targetDir, renameMap)
    const keysWritten = await writeWorkerKeysFile(targetDir, slug)
    const distSeeded = await writeDistClientPlaceholder(targetDir)

    // Internal-monorepo mode: append the new package paths to the closest
    // pnpm-workspace.yaml(s). Without this, `pnpm install` fails with
    // ERR_PNPM_WORKSPACE_PKG_NOT_FOUND on the workspace:* deps.
    const wsRegistration = workspace ? await registerWorkspaceMember(targetDir) : null

    // If pnpm install has already linked workspace deps in this targetDir,
    // run a quick `tsgo --noEmit` smoke. Catches template/kernel-runtime
    // drift before the user's first edit. Skipped silently when deps aren't
    // resolvable yet — the user runs `pnpm install` per the Next steps.
    const smoke = runScaffoldTypecheckSmoke(targetDir)

    const v = slugVariants(slug)
    const nextSteps = [
      `cd ${targetDir}`,
      `pnpm install   # run from workspace root`,
      `pnpm test      # in-process fixture smoke test`,
      `astrale domain dev up --kernel local:standalone:inprocess --domain local:inprocess`,
      `astrale domain deploy --skip-drift-check   # first deploy (soft-fail DNS-less)`,
      ``,
      `Template applied: ${template} (rewrote ${touched} files, renamed ${renamed} paths${keysWritten ? ', regenerated worker keypair' : ''}${distSeeded ? ', seeded dist-client/' : ''}${formatWorkspaceSuffix(wsRegistration)})`,
      `Variants: kebab=${v.kebab} pascal=${v.pascal} camel=${v.camel} upper=${v.upperSnake}`,
    ]
    nextSteps.push(...formatWorkspaceRegistration(wsRegistration, targetDir))
    nextSteps.push(...formatSmokeResult(smoke))

    return { targetDir, slug, nextSteps }
  },

  async deploy(opts: DeployOpts): Promise<DeployResult> {
    const { domainDir, preset = 'prod', skipDriftCheck = false } = opts
    if (!existsSync(join(domainDir, 'package.json'))) {
      throw new AstraleError(
        'NOT_A_DOMAIN',
        `Not a domain directory: ${domainDir} (no package.json)`,
        'Run from inside the domain folder, or pass --cwd.',
      )
    }

    const workerDir = join(domainDir, 'worker')
    if (!existsSync(workerDir)) {
      throw new AstraleError(
        'NO_WORKER_DIR',
        `Expected ${workerDir} to exist`,
        'Shape (b) umbrella domains have no worker and cannot be deployed.',
      )
    }

    const { specPath } = await lifecycleBuildSpec({ domainDir, preset })

    const { sdkDir } = findSdk(domainDir)
    const sdkCommit = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: sdkDir,
      encoding: 'utf-8',
    }).stdout.trim()
    if (!sdkCommit) {
      throw new AstraleError('NO_SDK_COMMIT', `Cannot read sdk/ HEAD at ${sdkDir}`)
    }
    const schemaHash = hashSpecFile(specPath)

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
    if (deployRes.status !== 0) {
      throw new AstraleError(
        'WRANGLER_FAILED',
        `wrangler deploy failed (exit ${deployRes.status ?? 'null'})`,
      )
    }

    const prodUrl = await resolveProdUrl(domainDir)
    const warnings: string[] = []
    if (skipDriftCheck) {
      warnings.push(`drift check skipped (zone: ${prodUrl})`)
      return { url: prodUrl, schemaHash, sdkCommit, warnings }
    }
    try {
      await deployCheck({ url: prodUrl, expectedSchemaHash: schemaHash, sdkRepoPath: sdkDir })
    } catch (e) {
      const msg = (e as Error).message
      const looksLikeDnsOrNetwork =
        /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|abort|fetch failed|getaddrinfo|Host not found|\b52[0-4]\b/i.test(
          msg,
        )
      if (looksLikeDnsOrNetwork) {
        warnings.push(
          `post-deploy check skipped: ${prodUrl} unreachable (${msg}). DNS may not be provisioned yet — smoke-test on the *.workers.dev URL above, or rerun once DNS is live.`,
        )
        return { url: prodUrl, schemaHash, sdkCommit, warnings }
      }
      throw new AstraleError(
        'DRIFT_CHECK_FAILED',
        `post-deploy drift check failed: ${msg}`,
        'schemaHash or sdkCommit mismatch — your local state does not match the worker. Use --skip-drift-check only for first-time deploys before DNS is live.',
      )
    }
    return { url: prodUrl, schemaHash, sdkCommit, warnings }
  },

  devUp: lifecycleDevUp,
  devDown: lifecycleDevDown,
  devStatus: lifecycleDevStatus,
  instancePrepare: lifecycleInstancePrepare,
  buildSpec: lifecycleBuildSpec,
}

type SmokeResult = { status: 'ok' | 'failed' | 'skipped'; errors?: string[] }

/**
 * Advisory typecheck after scaffold. Skipped when workspace deps aren't
 * linked yet — the user runs `pnpm install` first. Never throws; the
 * scaffold itself has already succeeded by the time this runs.
 */
function runScaffoldTypecheckSmoke(targetDir: string): SmokeResult {
  const depsLinked = existsSync(join(targetDir, 'node_modules', '@astrale-os', 'kernel-core'))
  if (!depsLinked) return { status: 'skipped' }
  const res = spawnSync('bunx', ['tsgo', '--noEmit'], {
    cwd: targetDir,
    encoding: 'utf-8',
    timeout: 60_000,
  })
  if (res.status === 0) return { status: 'ok' }
  const stdout = (res.stdout ?? '') + (res.stderr ?? '')
  const errors = stdout
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .slice(0, 5)
  return { status: 'failed', errors }
}

function formatWorkspaceRegistration(
  reg: WorkspaceRegistration | null,
  targetDir: string,
): string[] {
  if (!reg) return []
  const lines: string[] = []
  for (const update of reg.updated) {
    const n = update.added.length
    lines.push(`Registered in ${update.path} (+${n} ${n === 1 ? 'entry' : 'entries'})`)
  }
  for (const path of reg.alreadyPresent) {
    lines.push(`Already registered in ${path} — nothing to add.`)
  }
  for (const warning of reg.warnings) {
    lines.push(`⚠ ${warning}`)
  }
  if (lines.length === 0) {
    lines.push(`No pnpm-workspace.yaml ancestor found above ${targetDir} — registration skipped.`)
  }
  return lines
}

function formatSmokeResult(smoke: SmokeResult): string[] {
  if (smoke.status === 'ok') return [`Scaffold typechecks green (tsgo --noEmit).`]
  if (smoke.status !== 'failed') return []
  const errors = smoke.errors ?? []
  return [
    ``,
    `⚠ Scaffold typecheck failed (first ${errors.length} errors):`,
    ...errors.map((line) => `    ${line}`),
    `  If you didn't modify the scaffold output, this is template / kernel-runtime drift — please report it.`,
  ]
}

function buildGenericRenameMap(slug: string): ReturnType<typeof buildMinimalRemoteRenameMap> {
  const v = slugVariants(slug)
  return {
    literals: [{ from: '__SLUG__', to: v.kebab }],
    wordBoundary: [],
  }
}

function formatWorkspaceSuffix(reg: WorkspaceRegistration | null): string {
  const total = reg?.updated.length ?? 0
  if (total === 0) return ''
  return `, registered in ${total} pnpm-workspace.yaml file${total === 1 ? '' : 's'}`
}

/**
 * Derive the prod-preset worker URL from a domain's `envs.ts` export.
 */
async function resolveProdUrl(domainDir: string): Promise<string> {
  const envsPath = join(domainDir, 'envs.ts')
  if (!existsSync(envsPath)) {
    throw new AstraleError('NO_ENVS', `Missing envs.ts at ${envsPath}`)
  }
  type EnvsMod = { domainEnvs?: Record<string, () => DomainEnv> }
  const mod = await loadDomainModule<EnvsMod>(envsPath)
  const prodFn = mod.domainEnvs?.['prod']
  if (!prodFn) {
    throw new AstraleError(
      'NO_PROD_PRESET',
      `envs.ts does not export a 'prod' preset`,
      'Deploy requires a prod preset in domainEnvs.',
    )
  }
  return domainUrl(prodFn())
}
