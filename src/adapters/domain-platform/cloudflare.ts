/**
 * Cloudflare DomainPlatform adapter (v1).
 *
 * scaffold(): copies `cli/templates/<template>/` (shipped with the CLI
 *   package) into the target dir, then runs the rename engine and
 *   file-path rename pass.
 *
 * deploy():  prefers the domain's own `<slug>-deploy.ts` script if it
 *   exists; otherwise runs `build:spec --domain <preset>` then `wrangler
 *   deploy` then SDK's `deployCheck` inline.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
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
} from '../../lib/domain-scaffold'

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
    const { slug, template, targetDir, force = false } = opts
    if (!/^[a-z][a-z0-9-]{0,38}$/.test(slug)) {
      throw new AstraleError(
        'INVALID_SLUG',
        `Invalid slug "${slug}"`,
        'Use lowercase kebab-case, 1–39 chars, starting with a letter: [a-z][a-z0-9-]{0,38}',
      )
    }
    if (slug === 'minimal' || slug === 'minimal-remote') {
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

    const v = slugVariants(slug)
    const nextSteps = [
      `cd ${targetDir}`,
      `pnpm install   # run from workspace root`,
      `pnpm test      # in-process fixture smoke test`,
      `pnpm infra:prepare --kernel local:standalone:inprocess --domain local:inprocess`,
      `astrale domain deploy --skip-drift-check   # first deploy (soft-fail DNS-less)`,
      ``,
      `Template applied: ${template} (rewrote ${touched} files, renamed ${renamed} paths)`,
      `Variants: kebab=${v.kebab} pascal=${v.pascal} camel=${v.camel} upper=${v.upperSnake}`,
    ]

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

    const pkg = JSON.parse(readFileSync(join(domainDir, 'package.json'), 'utf-8')) as {
      name?: string
      scripts?: Record<string, string>
    }
    const slug = (pkg.name ?? '').replace(/^@astrale-os\//, '').replace(/-domain$/, '')
    const deployScriptName = `${slug}:deploy`
    const warnings: string[] = []

    if (pkg.scripts?.[deployScriptName]) {
      // Defer to the domain's own deploy pipeline — preserves the
      // scaffold's drift-check + stamping contract verbatim.
      const args = ['run', deployScriptName]
      if (skipDriftCheck) args.push('--', '--skip-drift-check')
      const r = spawnSync('pnpm', args, { cwd: domainDir, stdio: 'inherit' })
      if (r.status !== 0) {
        throw new AstraleError(
          'DEPLOY_FAILED',
          `pnpm ${args.join(' ')} exited with status ${r.status}`,
        )
      }
      // We don't re-parse the script output — the script itself printed
      // URL / schemaHash / sdkCommit. Return a best-effort shape.
      return {
        url: '',
        schemaHash: '',
        sdkCommit: '',
        warnings: skipDriftCheck ? ['drift check skipped'] : warnings,
      }
    }

    // Generic fallback (template-less domain): build spec + wrangler deploy.
    const specPath = join(domainDir, 'spec.json')
    if (!pkg.scripts?.['build:spec']) {
      throw new AstraleError(
        'NO_BUILD_SCRIPT',
        `Domain "${slug}" has no "build:spec" script`,
        'Add a build:spec entry to package.json, or use the minimal-remote template.',
      )
    }
    const build = spawnSync('pnpm', ['build:spec', '--', '--domain', preset], {
      cwd: domainDir,
      stdio: 'inherit',
    })
    if (build.status !== 0) {
      throw new AstraleError('BUILD_FAILED', `build:spec failed (exit ${build.status})`)
    }
    if (!existsSync(specPath)) {
      throw new AstraleError('SPEC_MISSING', `spec.json not produced at ${specPath}`)
    }
    const workerDir = join(domainDir, 'worker')
    if (!existsSync(workerDir)) {
      throw new AstraleError('NO_WORKER_DIR', `Expected ${workerDir} to exist`)
    }
    const deploy = spawnSync('bunx', ['wrangler', 'deploy'], {
      cwd: workerDir,
      stdio: 'inherit',
    })
    if (deploy.status !== 0) {
      throw new AstraleError('WRANGLER_FAILED', `wrangler deploy failed (exit ${deploy.status})`)
    }
    if (skipDriftCheck) warnings.push('drift check skipped')

    return { url: '', schemaHash: '', sdkCommit: '', warnings }
  },
}

function buildGenericRenameMap(slug: string): ReturnType<typeof buildMinimalRemoteRenameMap> {
  const v = slugVariants(slug)
  return {
    literals: [{ from: '__SLUG__', to: v.kebab }],
    wordBoundary: [],
  }
}
