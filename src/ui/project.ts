import { access, lstat, readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { loadConfig } from 'tsconfig-paths'

import { UiError, type PackageManager } from './model'

export type UiProject = {
  root: string
  packageJsonPath: string
  packageJson: Record<string, unknown>
  manager: PackageManager
  lockPath?: string
  cssPath: string
  componentsPath: string
  uiLockPath: string
  isAstraleDomain: boolean
}

const MANAGERS: readonly [string, PackageManager][] = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
  ['yarn.lock', 'yarn'],
  ['package-lock.json', 'npm'],
]

async function exists(target: string): Promise<boolean> {
  return access(target).then(
    () => true,
    () => false,
  )
}

async function readManifest(target: string): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await readFile(target, 'utf8')) as Record<string, unknown>
  } catch (cause) {
    throw new UiError('UI_PROJECT_UNSUPPORTED', 'package.json is not valid JSON.', undefined, {
      cause,
    })
  }
}

function pathPatternMatch(pattern: string, candidate: string): string | undefined {
  const wildcard = pattern.indexOf('*')
  if (wildcard === -1) return pattern === candidate ? '' : undefined
  const prefix = pattern.slice(0, wildcard)
  const suffix = pattern.slice(wildcard + 1)
  if (!candidate.startsWith(prefix) || !candidate.endsWith(suffix)) return undefined
  return candidate.slice(prefix.length, candidate.length - suffix.length)
}

function resolvePackageImport(project: UiProject, candidate: string): string | undefined {
  const imports = project.packageJson.imports
  if (!imports || typeof imports !== 'object' || Array.isArray(imports)) return undefined
  const matches = Object.entries(imports as Record<string, unknown>)
    .flatMap(([pattern, target]) => {
      const wildcard = pathPatternMatch(pattern, candidate)
      if (wildcard === undefined || typeof target !== 'string' || !target.startsWith('./'))
        return []
      const wildcardIndex = pattern.indexOf('*')
      return [
        {
          exact: wildcardIndex === -1,
          prefixLength: wildcardIndex === -1 ? pattern.length : wildcardIndex,
          suffixLength: wildcardIndex === -1 ? 0 : pattern.length - wildcardIndex - 1,
          target: target.replaceAll('*', wildcard),
        },
      ]
    })
    .sort(
      (left, right) =>
        Number(right.exact) - Number(left.exact) ||
        right.prefixLength - left.prefixLength ||
        right.suffixLength - left.suffixLength,
    )
  return matches[0] ? path.resolve(project.root, matches[0].target) : undefined
}

async function resolveAlias(project: UiProject, candidate: string): Promise<string | undefined> {
  const config = loadConfig(project.root)
  if (config.resultType === 'failed') return undefined
  const matches: Array<{
    exact: boolean
    prefixLength: number
    suffixLength: number
    resolved: string
  }> = []
  for (const [pattern, replacements] of Object.entries(config.paths)) {
    const wildcard = pathPatternMatch(pattern, candidate)
    if (wildcard === undefined) continue
    const replacement = replacements?.[0]
    if (!replacement) continue
    const wildcardIndex = pattern.indexOf('*')
    matches.push({
      exact: wildcardIndex === -1,
      prefixLength: wildcardIndex === -1 ? pattern.length : wildcardIndex,
      suffixLength: wildcardIndex === -1 ? 0 : pattern.length - wildcardIndex - 1,
      resolved: path.resolve(config.absoluteBaseUrl, replacement.replaceAll('*', wildcard)),
    })
  }
  matches.sort(
    (left, right) =>
      Number(right.exact) - Number(left.exact) ||
      right.prefixLength - left.prefixLength ||
      right.suffixLength - left.suffixLength,
  )
  const best = matches[0]
  if (!best) return undefined
  const ambiguous = matches.some(
    (match) =>
      match.exact === best.exact &&
      match.prefixLength === best.prefixLength &&
      match.suffixLength === best.suffixLength &&
      match.resolved !== best.resolved,
  )
  if (ambiguous) {
    throw new UiError(
      'UI_PROJECT_UNSUPPORTED',
      'The components alias resolves to conflicting project paths.',
      'Keep one authoritative compilerOptions.paths mapping for the components alias.',
    )
  }
  return best.resolved
}

export async function resolveUiRegistryTarget(
  project: UiProject,
  declaredTarget: string,
): Promise<string> {
  if (!declaredTarget.startsWith('components/')) return declaredTarget
  const components = await readFile(project.componentsPath, 'utf8')
    .then((value) => JSON.parse(value) as { aliases?: { components?: unknown } })
    .catch(() => undefined)
  const componentsAlias = components?.aliases?.components
  if (typeof componentsAlias !== 'string' || componentsAlias.length === 0) return declaredTarget
  const suffix = declaredTarget.slice('components/'.length)
  const directAlias = /^(?:\.?\.?\/|src\/|app\/|frontend\/|components\/)/u.test(componentsAlias)
  const resolved =
    resolvePackageImport(project, componentsAlias) ??
    (await resolveAlias(project, componentsAlias)) ??
    (directAlias ? path.resolve(project.root, componentsAlias) : undefined)
  if (!resolved) {
    throw new UiError(
      'UI_PROJECT_UNSUPPORTED',
      'components.json alias cannot be resolved through tsconfig.json or jsconfig.json.',
      'Define a matching compilerOptions.paths entry for ' + componentsAlias + '.',
    )
  }
  const relative = path.relative(project.root, path.join(resolved, suffix))
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    throw new UiError('UI_PROJECT_UNSUPPORTED', 'components.json alias escapes the project.')
  }
  return relative.split(path.sep).join('/')
}

function hasReactTailwind(manifest: Record<string, unknown>): boolean {
  const dependencies = {
    ...(manifest.dependencies as Record<string, string> | undefined),
    ...(manifest.devDependencies as Record<string, string> | undefined),
    ...(manifest.peerDependencies as Record<string, string> | undefined),
  }
  return Boolean(dependencies.react && dependencies['react-dom'] && dependencies.tailwindcss)
}

async function assertPhysicalProjectPath(root: string, target: string): Promise<void> {
  const physicalRoot = await realpath(root)
  let existing = target
  while (!(await exists(existing))) {
    const parent = path.dirname(existing)
    if (parent === existing) break
    existing = parent
  }
  const physicalTarget = await realpath(existing)
  const relative = path.relative(physicalRoot, physicalTarget)
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    throw new UiError('UI_PROJECT_UNSUPPORTED', 'components.json CSS path escapes the project.')
  }
}

export async function discoverUiProject(input = process.cwd()): Promise<UiProject> {
  let root = path.resolve(input)
  if (!(await exists(root))) {
    throw new UiError('UI_PROJECT_UNSUPPORTED', 'Project path does not exist: ' + root)
  }
  if (!(await lstat(root)).isDirectory()) root = path.dirname(root)

  while (true) {
    const manifestPath = path.join(root, 'package.json')
    if (await exists(manifestPath)) {
      const manifest = await readManifest(manifestPath)
      const parent = path.dirname(root)
      if (hasReactTailwind(manifest) || parent === root) break
      if (await exists(path.join(parent, 'package.json'))) {
        root = parent
        continue
      }
      break
    }
    const parent = path.dirname(root)
    if (parent === root) {
      throw new UiError(
        'UI_PROJECT_UNSUPPORTED',
        'No package.json found from ' + path.resolve(input),
        'Run the command inside an existing React application or pass its path.',
      )
    }
    root = parent
  }

  const packageJsonPath = path.join(root, 'package.json')
  const packageJson = await readManifest(packageJsonPath)

  let manager: PackageManager = 'npm'
  let lockPath: string | undefined
  for (const [file, candidate] of MANAGERS) {
    const target = path.join(root, file)
    if (await exists(target)) {
      manager = candidate
      lockPath = target
      break
    }
  }
  const declared = packageJson.packageManager
  if (!lockPath && typeof declared === 'string') {
    const candidate = declared.split('@')[0]
    if (
      candidate === 'pnpm' ||
      candidate === 'npm' ||
      candidate === 'yarn' ||
      candidate === 'bun'
    ) {
      manager = candidate
    }
  }
  if (!lockPath) {
    const expectedLock = {
      pnpm: 'pnpm-lock.yaml',
      npm: 'package-lock.json',
      yarn: 'yarn.lock',
      bun: 'bun.lock',
    }[manager]
    lockPath = path.join(root, expectedLock)
  }

  const rootCssCandidates = ['src/index.css', 'src/app.css', 'app/globals.css', 'src/styles.css']
  const frontendCssCandidates = [
    'frontend/src/index.css',
    'frontend/src/app.css',
    'frontend/src/styles.css',
  ]
  const componentsPath = path.join(root, 'components.json')
  const configuredCss = await readFile(componentsPath, 'utf8')
    .then((value) => {
      const components = JSON.parse(value) as { tailwind?: { css?: unknown } }
      const css = components.tailwind?.css
      if (typeof css !== 'string' || css.length === 0) return undefined
      const target = path.resolve(root, css)
      const relative = path.relative(root, target)
      if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
        throw new UiError('UI_PROJECT_UNSUPPORTED', 'components.json CSS path escapes the project.')
      }
      return { relative: relative.split(path.sep).join('/'), target }
    })
    .catch((error: unknown) => {
      if (error instanceof UiError) throw error
      return undefined
    })
  const configuredCssRelative = configuredCss?.relative
  const cssCandidates =
    configuredCssRelative !== undefined
      ? [configuredCssRelative]
      : (await exists(path.join(root, 'frontend/package.json')))
        ? [...frontendCssCandidates, ...rootCssCandidates]
        : [...rootCssCandidates, ...frontendCssCandidates]
  const resolvedCss = await Promise.all(
    cssCandidates.map(async (file) => ((await exists(path.join(root, file))) ? file : undefined)),
  )
  const cssRelative = configuredCssRelative ?? resolvedCss.find(Boolean) ?? 'src/astrale-ui.css'
  await assertPhysicalProjectPath(root, path.join(root, cssRelative))

  return {
    root,
    packageJsonPath,
    packageJson,
    manager,
    lockPath,
    cssPath: path.join(root, cssRelative),
    componentsPath,
    uiLockPath: path.join(root, 'astrale-ui.lock.json'),
    isAstraleDomain:
      (await exists(path.join(root, 'astrale.config.ts'))) &&
      (await exists(path.join(root, 'ui/index.ts'))) &&
      (await exists(path.join(root, 'frontend/package.json'))),
  }
}

export function assertSupportedUiProject(project: UiProject): void {
  const manifest = project.packageJson
  const dependencies = {
    ...(manifest.dependencies as Record<string, string> | undefined),
    ...(manifest.devDependencies as Record<string, string> | undefined),
    ...(manifest.peerDependencies as Record<string, string> | undefined),
  }
  if (!dependencies.react || !dependencies['react-dom']) {
    throw new UiError(
      'UI_PROJECT_UNSUPPORTED',
      'Astrale UI requires an existing React application.',
      'Install React first or choose a non-UI project scaffold.',
    )
  }
  const tailwind = dependencies.tailwindcss
  if (!tailwind || !/(?:^|[^0-9])4(?:\.|$)/u.test(tailwind)) {
    throw new UiError(
      'UI_PROJECT_UNSUPPORTED',
      'Astrale UI V1 requires Tailwind CSS 4.',
      'Upgrade Tailwind to v4 before initializing Astrale UI.',
    )
  }
}

export function projectRelative(project: UiProject, target: string): string {
  const relative = path.relative(project.root, target)
  if (
    relative === '' ||
    relative === '..' ||
    relative.startsWith('..' + path.sep) ||
    path.isAbsolute(relative)
  ) {
    throw new UiError('UI_LOCK_INVALID', 'Path escapes the project root: ' + target)
  }
  return relative.split(path.sep).join('/')
}
