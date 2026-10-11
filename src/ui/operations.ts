import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { isSeq, parseDocument } from 'yaml'

import { run } from '../lib/proc'
import { exists, fileDigest, readOptional, sha256, withRollback, writeJson } from './files'
import { lockedIdentity, parseUiLock, readUiLock } from './lock'
import {
  UI_LOCK_FILE,
  UI_PACKAGE,
  UI_PRESETS,
  THEME_TOKENS,
  UI_REPOSITORY,
  UiError,
  type PackageManager,
  type UiLock,
  type UiPreset,
  type UiRegistryItem,
  type UiRelease,
  type UiRunner,
} from './model'
import {
  assertSupportedUiProject,
  discoverUiProject,
  projectRelative,
  resolveUiRegistryTarget,
  type UiProject,
} from './project'
import {
  readUiRegistryItem,
  readUiReleaseSnapshot,
  registryItemUrl,
  resolveUiRelease,
} from './release'

type Dependencies = { fetcher?: typeof fetch; runner?: UiRunner }
type SourceOptions = { dryRun?: boolean; overwrite?: boolean }

const defaultRunner: UiRunner = (file, args, cwd) => run(file, args, { cwd })

const LOCAL_THEME_MAX_BYTES = 131_072
const THEME_SLUG = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u
const PACKAGE_CSS_IMPORT =
  /^@import\s+['"]@astrale-os\/ui\/(?:theme\.css|presets\/[a-z-]+\.css)['"];?\s*$/u

function shadcnInvocation(manager: PackageManager, version: string, args: string[]) {
  const shadcn = 'shadcn@' + version
  if (manager === 'pnpm') return { file: 'pnpm', args: ['dlx', shadcn, ...args] }
  if (manager === 'bun') return { file: 'bunx', args: [shadcn, ...args] }
  if (manager === 'yarn') return { file: 'yarn', args: ['dlx', shadcn, ...args] }
  return { file: 'npx', args: ['--yes', shadcn, ...args] }
}

async function installDependencies(project: UiProject, runner: UiRunner, context: string) {
  const result = await runner(project.manager, ['install'], project.root)
  if (result.code !== 0) {
    throw new UiError(
      'UI_DEPENDENCY_INSTALL_FAILED',
      `${project.manager} install failed${context}.`,
      result.stderr.trim() || undefined,
    )
  }
}

function isLocalThemeAddress(address: string): boolean {
  return (address.startsWith('./') || address.startsWith('../')) && address.endsWith('.css')
}

function admitThemeCss(source: string, slug: string): void {
  if (new TextEncoder().encode(source).byteLength > LOCAL_THEME_MAX_BYTES) {
    throw new UiError('UI_ITEM_CONFLICT', 'Local theme CSS exceeds 128 KiB.')
  }
  if (
    !source.includes('Consumer-owned after installation.') ||
    !source.includes("[data-ui-theme='" + slug + "']") ||
    !source.includes("[data-ui-theme='" + slug + "'].dark") ||
    /@import\b|url\s*\(/iu.test(source) ||
    THEME_TOKENS.some((token) => source.match(new RegExp(`--ui-${token}:`, 'gu'))?.length !== 2)
  ) {
    throw new UiError(
      'UI_ITEM_CONFLICT',
      'Local theme CSS is not an admitted Astrale playground export.',
      'Export the CSS from the Astrale UI playground, keep its filename aligned with the theme name, and try again.',
    )
  }
}

function themeImport(project: UiProject, target: string): string {
  let relative = path.relative(path.dirname(project.cssPath), target).split(path.sep).join('/')
  if (!relative.startsWith('.')) relative = './' + relative
  return "@import '" + relative + "';"
}

/** Replace any active theme import by `statement`, right after the package CSS imports. */
function activateTheme(css: string, statement: string): string {
  const lines = css
    .split(/\r?\n/u)
    .filter(
      (line) =>
        !/^@import\s+['"][^'"]*components\/astrale\/theme\/[a-z][a-z0-9-]*\.css['"];?\s*$/u.test(
          line,
        ),
    )
  lines.splice(lines.findLastIndex((line) => PACKAGE_CSS_IMPORT.test(line)) + 1, 0, statement)
  return lines
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .replace(/^\n/u, '')
}

type DependencySection = 'dependencies' | 'devDependencies'

function dependenciesOf(
  manifest: Record<string, unknown>,
  section: DependencySection = 'dependencies',
): Record<string, string> {
  return { ...(manifest[section] as Record<string, string> | undefined) }
}

function otherSection(section: DependencySection): DependencySection {
  return section === 'dependencies' ? 'devDependencies' : 'dependencies'
}

/** The one section that declares the UI package, or `fallback` when none does. */
function uiDependencySection(
  manifest: Record<string, unknown>,
  fallback: DependencySection = 'dependencies',
): DependencySection {
  const runtime = Object.hasOwn(dependenciesOf(manifest), UI_PACKAGE)
  const development = Object.hasOwn(dependenciesOf(manifest, 'devDependencies'), UI_PACKAGE)
  if (runtime && development) {
    throw new UiError(
      'UI_PROJECT_UNSUPPORTED',
      UI_PACKAGE + ' must be declared in exactly one dependency section.',
      'Remove it from either dependencies or devDependencies, then retry.',
    )
  }
  return development ? 'devDependencies' : runtime ? 'dependencies' : fallback
}

function setUiDependency(
  manifest: Record<string, unknown>,
  section: DependencySection,
  version: string,
): void {
  manifest[section] = { ...dependenciesOf(manifest, section), [UI_PACKAGE]: version }
  const other = dependenciesOf(manifest, otherSection(section))
  if (Object.hasOwn(other, UI_PACKAGE)) {
    delete other[UI_PACKAGE]
    manifest[otherSection(section)] = other
  }
}

/** An Astrale Domain keeps the shadcn registry source in a private `components` workspace. */
const REGISTRY_WORKSPACE = 'components'

function registryPackagePath(project: UiProject): string {
  return path.join(project.root, REGISTRY_WORKSPACE, 'package.json')
}

function pnpmWorkspacePath(project: UiProject): string {
  return path.join(project.root, 'pnpm-workspace.yaml')
}

function registryPackageName(manifest: Record<string, unknown>): string {
  return (typeof manifest.name === 'string' ? manifest.name : 'astrale-domain') + '-ui-registry'
}

function npmWorkspaces(manifest: Record<string, unknown>): unknown {
  const configured = manifest.workspaces
  return configured && typeof configured === 'object' && !Array.isArray(configured)
    ? (configured as { packages?: unknown }).packages
    : configured
}

function addNpmWorkspace(manifest: Record<string, unknown>, workspace: string): void {
  const current = npmWorkspaces(manifest) ?? []
  if (!Array.isArray(current) || !current.every((value) => typeof value === 'string')) {
    throw new UiError('UI_PROJECT_UNSUPPORTED', 'package.json has an invalid workspaces field.')
  }
  if (current.includes(workspace)) return
  const packages = [...current, workspace]
  manifest.workspaces =
    manifest.workspaces && !Array.isArray(manifest.workspaces)
      ? { ...(manifest.workspaces as object), packages }
      : packages
}

async function pnpmWorkspaces(project: UiProject) {
  const source = await readOptional(pnpmWorkspacePath(project))
  if (source === undefined) return undefined
  const document = parseDocument(source)
  const packages = document.errors.length === 0 ? document.get('packages', true) : undefined
  const values = isSeq(packages) ? packages.toJSON() : undefined
  const valid = Array.isArray(values) && values.every((value) => typeof value === 'string')
  return { document, packages: valid && isSeq(packages) ? packages : undefined, values }
}

async function addPnpmWorkspace(project: UiProject, workspace: string): Promise<void> {
  const workspaces = await pnpmWorkspaces(project)
  if (workspaces === undefined) {
    await writeFile(pnpmWorkspacePath(project), "packages:\n  - '" + workspace + "'\n", 'utf8')
    return
  }
  if (!workspaces.packages) {
    throw new UiError(
      'UI_PROJECT_UNSUPPORTED',
      'pnpm-workspace.yaml must declare a packages sequence.',
    )
  }
  if (!(workspaces.values as string[]).includes(workspace)) workspaces.packages.add(workspace)
  await writeFile(pnpmWorkspacePath(project), String(workspaces.document), 'utf8')
}

async function hasRegistryWorkspace(project: UiProject): Promise<boolean> {
  const manifest = await readOptional(registryPackagePath(project))
  if (!project.isAstraleDomain || manifest === undefined) return false
  const registry = JSON.parse(manifest) as Record<string, unknown>
  if (
    registry.private !== true ||
    typeof registry.name !== 'string' ||
    registry.name === UI_PACKAGE ||
    registry.name === project.packageJson.name
  ) {
    return false
  }
  const workspaces =
    project.manager === 'pnpm'
      ? (await pnpmWorkspaces(project))?.values
      : npmWorkspaces(project.packageJson)
  return Array.isArray(workspaces) && workspaces.includes(REGISTRY_WORKSPACE)
}

async function writeRegistryWorkspace(
  project: UiProject,
  manifest: Record<string, unknown>,
): Promise<void> {
  if (!project.isAstraleDomain) return
  if (project.manager === 'pnpm') await addPnpmWorkspace(project, REGISTRY_WORKSPACE)
  else addNpmWorkspace(manifest, REGISTRY_WORKSPACE)
  const existing = await readOptional(registryPackagePath(project))
  const registry = existing
    ? (JSON.parse(existing) as Record<string, unknown>)
    : { name: registryPackageName(manifest) }
  if (registry.private === false) {
    throw new UiError(
      'UI_PROJECT_UNSUPPORTED',
      'The Astrale registry source workspace must remain private.',
    )
  }
  if (
    registry.name === UI_PACKAGE ||
    registry.name === manifest.name ||
    (registry.name !== undefined && typeof registry.name !== 'string')
  ) {
    throw new UiError(
      'UI_PROJECT_UNSUPPORTED',
      'The Astrale registry source workspace must have a distinct package name.',
    )
  }
  await writeJson(registryPackagePath(project), {
    ...registry,
    name: registry.name ?? registryPackageName(manifest),
    private: true,
    type: registry.type ?? 'module',
  })
}

export type InitUiOptions = {
  path?: string
  preset?: UiPreset
  version?: string
  dryRun?: boolean
  force?: boolean
  install?: boolean
}

/** Whether an existing initialization already matches the requested release and preset. */
async function initializedAsRequested(
  project: UiProject,
  lock: UiLock,
  options: InitUiOptions,
): Promise<boolean> {
  const declared = dependenciesOf(project.packageJson, uiDependencySection(project.packageJson))
  const css = (await readOptional(project.cssPath)) ?? ''
  const components = await readOptional(project.componentsPath)
    .then((value) => (value ? (JSON.parse(value) as Record<string, unknown>) : undefined))
    .catch(() => undefined)
  const requestedVersion = options.version?.replace(/^v/u, '')
  return (
    (!requestedVersion || requestedVersion === lock.package.version) &&
    declared[UI_PACKAGE] === lock.package.version &&
    (!options.preset || options.preset === lock.preset) &&
    css.includes(UI_PACKAGE + '/theme.css') &&
    css.includes(UI_PACKAGE + '/presets/' + lock.preset + '.css') &&
    components?.style === 'base-nova' &&
    (!project.isAstraleDomain || (await hasRegistryWorkspace(project)))
  )
}

export async function initUi(
  options: InitUiOptions,
  dependencies: Dependencies = {},
): Promise<Record<string, unknown>> {
  const project = await discoverUiProject(options.path)
  await projectPath(project, UI_LOCK_FILE)
  assertSupportedUiProject(project)
  const preset = options.preset ?? 'astrale'
  if (!UI_PRESETS.includes(preset)) {
    throw new UiError('UI_PROJECT_UNSUPPORTED', 'Unknown UI preset: ' + preset)
  }
  if ((await exists(project.uiLockPath)) && !options.force) {
    const lock = await readUiLock(project.uiLockPath)
    if (!(await initializedAsRequested(project, lock, options))) {
      throw new UiError(
        'UI_ITEM_CONFLICT',
        'Existing Astrale UI initialization differs from the requested state.',
        'Run astrale ui doctor, then repeat init with --force after reviewing the changes.',
      )
    }
    return { status: 'unchanged', root: project.root, lock }
  }
  const release = await resolveUiRelease(options.version, dependencies.fetcher)
  const cssRelative = projectRelative(project, project.cssPath)
  const domainFiles = project.isAstraleDomain
    ? [
        registryPackagePath(project),
        ...(project.manager === 'pnpm' ? [pnpmWorkspacePath(project)] : []),
      ]
    : []
  const mutated = [
    project.packageJsonPath,
    project.cssPath,
    project.componentsPath,
    project.uiLockPath,
    ...domainFiles,
    ...(project.lockPath ? [project.lockPath] : []),
  ]
  const tooling = {
    shadcn: release.compatibility.shadcn,
    base: release.compatibility.base,
    style: release.compatibility.style,
    baseUi: release.compatibility.baseUi,
  }
  const plan = {
    status: options.dryRun ? 'planned' : 'initialized',
    root: project.root,
    package: UI_PACKAGE + '@' + release.version,
    manager: project.manager,
    preset,
    files: mutated.map((target) => projectRelative(project, target)),
    tooling,
  }
  if (options.dryRun) return plan
  for (const target of domainFiles) await projectPath(project, projectRelative(project, target))

  return withRollback(mutated, async () => {
    const manifest = { ...project.packageJson }
    setUiDependency(manifest, uiDependencySection(manifest), release.version)
    await writeRegistryWorkspace(project, manifest)
    await writeJson(project.packageJsonPath, manifest)

    const css = ((await readOptional(project.cssPath)) ?? '')
      .split('\n')
      .filter((line) => !PACKAGE_CSS_IMPORT.test(line))
      .join('\n')
      .trimStart()
    const imports = [
      "@import '" + UI_PACKAGE + "/theme.css';",
      "@import '" + UI_PACKAGE + '/presets/' + preset + ".css';",
    ]
    await mkdir(path.dirname(project.cssPath), { recursive: true })
    await writeFile(project.cssPath, imports.join('\n') + '\n\n' + css, 'utf8')

    const components = JSON.parse((await readOptional(project.componentsPath)) ?? '{}') as Record<
      string,
      unknown
    >
    await writeJson(project.componentsPath, {
      $schema: 'https://ui.shadcn.com/schema.json',
      ...components,
      style: 'base-nova',
      rsc: components.rsc ?? false,
      tsx: components.tsx ?? true,
      tailwind: {
        config: '',
        baseColor: 'neutral',
        cssVariables: true,
        prefix: '',
        ...(components.tailwind as Record<string, unknown> | undefined),
        css: cssRelative,
      },
      aliases: {
        components: '@/components',
        utils: '@/lib/utils',
        ui: '@/components/ui',
        lib: '@/lib',
        hooks: '@/hooks',
        ...(components.aliases as Record<string, unknown> | undefined),
      },
    })

    if (options.install !== false) {
      await installDependencies(project, dependencies.runner ?? defaultRunner, '')
    }

    const lock: UiLock = {
      $schema: `https://raw.githubusercontent.com/${UI_REPOSITORY}/${release.ref}/schemas/ui-lock.schema.json`,
      version: 1,
      package: { name: UI_PACKAGE, version: release.version },
      registry: { repository: UI_REPOSITORY, ref: release.ref, commit: release.commit },
      tooling: { shadcn: tooling.shadcn, base: 'base', style: 'nova', baseUi: tooling.baseUi },
      preset,
      items: {},
    }
    await writeJson(project.uiLockPath, lock)
    return { ...plan, lock }
  })
}

/** Put the locked UI version back after shadcn applied its own compatible range. */
async function pinUiDependency(
  project: UiProject,
  version: string,
  section: DependencySection,
  runner: UiRunner,
): Promise<void> {
  const manifest = JSON.parse(await readFile(project.packageJsonPath, 'utf8')) as Record<
    string,
    unknown
  >
  if (
    dependenciesOf(manifest, section)[UI_PACKAGE] === version &&
    dependenciesOf(manifest, otherSection(section))[UI_PACKAGE] === undefined
  ) {
    return
  }
  setUiDependency(manifest, section, version)
  await writeJson(project.packageJsonPath, manifest)
  await installDependencies(project, runner, ' while restoring the locked UI release')
}

async function lockedRelease(
  project: UiProject,
  fetcher?: typeof fetch,
): Promise<{ lock: UiLock; release: UiRelease }> {
  const lock = await readUiLock(project.uiLockPath)
  return { lock, release: await readUiReleaseSnapshot(lockedIdentity(lock), fetcher) }
}

export async function listLockedUi(
  input: string | undefined,
  dependencies: Dependencies = {},
): Promise<UiRegistryItem[]> {
  const { release } = await lockedRelease(await discoverUiProject(input), dependencies.fetcher)
  return release.registry.items
}

function localChanges(file: string, hint = 'repeat add'): UiError {
  return new UiError(
    'UI_LOCAL_CHANGES',
    'Installed UI file has local changes: ' + file,
    `Review the file, then ${hint} with explicit --overwrite --yes.`,
  )
}

async function installTheme(
  slug: string,
  source: string,
  sourceDigest: string,
  sourceLabel: string,
  project: UiProject,
  options: SourceOptions,
): Promise<Record<string, unknown>> {
  const lock = await readUiLock(project.uiLockPath)
  const address = 'theme/' + slug
  const relativeTarget = 'components/astrale/theme/' + slug + '.css'
  const target = await projectPath(project, relativeTarget)
  const existing = await readOptional(target)
  const installed = lock.items[address]
  if (existing !== undefined && !installed && !options.overwrite) {
    throw new UiError(
      'UI_LOCAL_CHANGES',
      'Theme target already exists outside the Astrale UI lock: ' + relativeTarget,
      'Review the file, then repeat with explicit --overwrite --yes.',
    )
  }
  if (
    installed &&
    !options.overwrite &&
    installed.files[relativeTarget] !== sha256(existing ?? '')
  ) {
    throw localChanges(relativeTarget)
  }
  const statement = themeImport(project, target)
  const files = { [relativeTarget]: sha256(source) }
  const result = {
    status: options.dryRun ? 'planned' : 'installed',
    items: [address],
    files: { [address]: files },
    activation: { file: projectRelative(project, project.cssPath), import: statement },
    source: sourceLabel,
  }
  if (options.dryRun) return result

  return withRollback([target, project.cssPath, project.uiLockPath], async () => {
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, source, 'utf8')
    const css = (await readOptional(project.cssPath)) ?? ''
    await writeFile(project.cssPath, activateTheme(css, statement), 'utf8')
    lock.items[address] = { address, sourceDigest, files }
    await writeJson(project.uiLockPath, lock)
    return result
  })
}

async function addLocalTheme(
  address: string,
  project: UiProject,
  options: SourceOptions,
): Promise<Record<string, unknown>> {
  const sourcePath = path.resolve(project.root, address)
  const sourceInfo = await lstat(sourcePath).catch(() => undefined)
  if (!sourceInfo?.isFile()) {
    throw new UiError('UI_ITEM_NOT_FOUND', 'Local theme is not a regular file: ' + address)
  }
  const slug = path.basename(sourcePath, '.css')
  if (!THEME_SLUG.test(slug)) {
    throw new UiError(
      'UI_ITEM_CONFLICT',
      'Local theme filename must be a kebab-case theme name.',
      'Rename it to a name such as observatory.css.',
    )
  }
  const source = await readFile(sourcePath, 'utf8')
  admitThemeCss(source, slug)
  return installTheme(slug, source, sha256(source), address, project, options)
}

async function addReleasedTheme(
  document: UiRegistryItem,
  project: UiProject,
  options: SourceOptions,
): Promise<Record<string, unknown>> {
  const address = document.meta.canonicalAddress
  const slug = address.slice('theme/'.length)
  const source = document.files[0]?.content
  if (typeof source !== 'string') {
    throw new UiError('UI_REGISTRY_UNAVAILABLE', 'The released theme has no admitted CSS source.')
  }
  admitThemeCss(source, slug)
  return installTheme(slug, source, sha256(JSON.stringify(document)), address, project, options)
}

export async function addUi(
  addresses: string[],
  options: SourceOptions & { project?: string; yes?: boolean },
  dependencies: Dependencies = {},
): Promise<Record<string, unknown>> {
  if (addresses.length === 0) {
    throw new UiError('UI_ITEM_NOT_FOUND', 'No UI item was provided.')
  }
  const project = await discoverUiProject(options.project)
  await projectPath(project, UI_LOCK_FILE)
  if (options.overwrite && !options.yes) {
    throw new UiError(
      'UI_LOCAL_CHANGES',
      'Replacing installed UI source requires explicit confirmation.',
      'Review the locally edited files, then repeat with both --overwrite and --yes.',
    )
  }
  if (addresses.some(isLocalThemeAddress)) {
    if (addresses.length !== 1) {
      throw new UiError(
        'UI_ITEM_CONFLICT',
        'Install one local theme at a time and do not mix local files with registry addresses.',
      )
    }
    return addLocalTheme(addresses[0]!, project, options)
  }
  const { lock, release } = await lockedRelease(project, dependencies.fetcher)
  const dependencySection = uiDependencySection(project.packageJson)
  const items = addresses.map((address) => findItem(release, address))
  const documents = await Promise.all(
    items.map((item) => readUiRegistryItem(release, item, dependencies.fetcher)),
  )
  if (items.some((item) => item.type === 'registry:theme')) {
    if (items.length !== 1) {
      throw new UiError(
        'UI_ITEM_CONFLICT',
        'Install a released theme separately from patterns and blocks.',
      )
    }
    return addReleasedTheme(documents[0]!, project, options)
  }
  if (!options.overwrite) await rejectLocalChanges(project, lock, items)
  const resolvedTargets = new Map(
    await Promise.all(
      items
        .flatMap((item) => item.files.flatMap((file) => (file.target ? [file.target] : [])))
        .map(async (target) => [target, await resolveUiRegistryTarget(project, target)] as const),
    ),
  )
  const targets = [
    ...new Set(
      await Promise.all(
        [...resolvedTargets.values()].map((target) => projectPath(project, target)),
      ),
    ),
  ]
  const invocation = shadcnInvocation(project.manager, release.compatibility.shadcn, [
    'add',
    ...items.map((item) => registryItemUrl(release, item.name)),
    '--cwd',
    project.root,
    ...(options.dryRun ? ['--dry-run'] : []),
    ...(options.overwrite ? ['--overwrite'] : []),
    ...(options.yes ? ['--yes'] : []),
  ])
  const runner = dependencies.runner ?? defaultRunner
  const runShadcn = async () => {
    const result = await runner(invocation.file, invocation.args, project.root)
    if (result.code !== 0) {
      throw new UiError(
        'UI_TOOL_FAILED',
        'The pinned shadcn operation failed.',
        result.stderr.trim(),
      )
    }
    return result
  }

  if (options.dryRun) {
    const result = await runShadcn()
    return {
      status: 'planned',
      items: items.map((item) => item.meta.canonicalAddress),
      sources: documents.map((item) => ({
        address: item.meta.canonicalAddress,
        dependencies: item.dependencies ?? [],
        files: item.files.flatMap((file) =>
          file.target ? [resolvedTargets.get(file.target)!] : [],
        ),
      })),
      command: [invocation.file, ...invocation.args],
      output: result.stdout,
    }
  }

  const mutated = [project.packageJsonPath, project.lockPath!, project.cssPath, project.uiLockPath]
  return withRollback([...mutated, ...targets], async () => {
    await runShadcn()
    for (const target of targets) {
      if (!(await exists(target))) {
        throw new UiError('UI_TOOL_FAILED', 'The pinned shadcn operation omitted an item file.')
      }
    }
    await pinUiDependency(project, lock.package.version, dependencySection, runner)
    for (const [index, item] of items.entries()) {
      const files: Record<string, string> = {}
      for (const file of item.files) {
        if (!file.target) continue
        const target = await projectPath(project, resolvedTargets.get(file.target)!)
        files[projectRelative(project, target)] = await fileDigest(target)
      }
      const address = item.meta.canonicalAddress
      lock.items[address] = {
        address,
        sourceDigest: sha256(JSON.stringify(documents[index])),
        files,
      }
    }
    await writeJson(project.uiLockPath, lock)
    return {
      status: 'installed',
      items: items.map((item) => item.meta.canonicalAddress),
      files: Object.fromEntries(
        items.map((item) => [
          item.meta.canonicalAddress,
          lock.items[item.meta.canonicalAddress]?.files,
        ]),
      ),
    }
  })
}

type DoctorCheck = { check: string; ok: boolean; detail?: string }

export async function doctorUi(
  input?: string,
): Promise<{ healthy: boolean; checks: DoctorCheck[] }> {
  const project = await discoverUiProject(input)
  const checks: DoctorCheck[] = []
  let lock: UiLock | undefined
  try {
    lock = parseUiLock(JSON.parse(await readFile(project.uiLockPath, 'utf8')))
    checks.push({ check: 'lock', ok: true })
  } catch (error) {
    checks.push({ check: 'lock', ok: false, detail: (error as Error).message })
  }
  const runtime = dependenciesOf(project.packageJson)[UI_PACKAGE]
  const development = dependenciesOf(project.packageJson, 'devDependencies')[UI_PACKAGE]
  const declared = [runtime, development].filter((version) => typeof version === 'string')
  const version = declared.length === 1 ? declared[0] : undefined
  checks.push({
    check: 'package',
    ok: version !== undefined && (!lock || version === lock.package.version),
    detail:
      declared.length > 1
        ? 'declared in dependencies and devDependencies'
        : version === undefined
          ? 'missing'
          : (runtime === version ? 'dependencies:' : 'devDependencies:') + version,
  })
  const css = (await readOptional(project.cssPath)) ?? ''
  checks.push({ check: 'theme', ok: css.includes(UI_PACKAGE + '/theme.css') })
  checks.push({
    check: 'preset',
    ok: UI_PRESETS.some((preset) => css.includes(UI_PACKAGE + '/presets/' + preset + '.css')),
  })
  checks.push({ check: 'components', ok: await exists(project.componentsPath) })
  if (lock) {
    for (const item of Object.values(lock.items)) {
      for (const [file, expected] of Object.entries(item.files)) {
        const actual = await fileDigest(path.join(project.root, file))
        checks.push({ check: 'item:' + item.address + ':' + file, ok: actual === expected })
      }
    }
    const themeFiles = Object.values(lock.items)
      .filter((item) => item.address.startsWith('theme/'))
      .flatMap((item) => Object.keys(item.files).filter((file) => file.endsWith('.css')))
    if (themeFiles.length > 0) {
      checks.push({
        check: 'theme-active',
        ok: themeFiles.some((file) =>
          css.includes(themeImport(project, path.join(project.root, file))),
        ),
      })
    }
  }
  return { healthy: checks.every((check) => check.ok), checks }
}

export async function applyPreset(
  preset: UiPreset,
  options: { project?: string; dryRun?: boolean },
): Promise<Record<string, unknown>> {
  if (!UI_PRESETS.includes(preset)) {
    throw new UiError('UI_ITEM_NOT_FOUND', 'Unknown preset: ' + preset)
  }
  const project = await discoverUiProject(options.project)
  await projectPath(project, UI_LOCK_FILE)
  const lock = await readUiLock(project.uiLockPath)
  const css = (await readOptional(project.cssPath)) ?? ''
  if (!css.includes('@astrale-os/ui/presets/')) {
    throw new UiError('UI_CONFIG_MISSING', 'No Astrale preset import was found.')
  }
  if (!options.dryRun) {
    await writeFile(
      project.cssPath,
      css.replace(
        /@astrale-os\/ui\/presets\/[a-z-]+\.css/gu,
        `@astrale-os/ui/presets/${preset}.css`,
      ),
      'utf8',
    )
    lock.preset = preset
    await writeJson(project.uiLockPath, lock)
  }
  return {
    status: options.dryRun ? 'planned' : 'applied',
    preset,
    file: projectRelative(project, project.cssPath),
  }
}

function findItem(release: UiRelease, address: string): UiRegistryItem {
  const normalized = address.replace(/^@astrale\//u, '')
  const exact = release.registry.items.find(
    (item) => item.meta.canonicalAddress === normalized || item.name === normalized,
  )
  if (exact) return exact
  const shorthand = release.registry.items.filter((item) =>
    item.meta.canonicalAddress.endsWith('/' + normalized),
  )
  if (shorthand.length === 1) return shorthand[0]!
  throw new UiError(
    'UI_ITEM_NOT_FOUND',
    shorthand.length > 1
      ? 'UI item "' + address + '" is ambiguous.'
      : 'UI item "' + address + '" was not found.',
    shorthand.length > 1
      ? 'Use one of: ' + shorthand.map((item) => item.meta.canonicalAddress).join(', ')
      : 'Run astrale ui search with a short description to discover canonical addresses.',
  )
}

async function rejectLocalChanges(
  project: UiProject,
  lock: UiLock,
  items: UiRegistryItem[],
): Promise<void> {
  for (const item of items) {
    const installed = lock.items[item.meta.canonicalAddress]
    for (const [file, expected] of Object.entries(installed?.files ?? {})) {
      if ((await fileDigest(path.join(project.root, file))) !== expected) throw localChanges(file)
    }
  }
}

/**
 * The absolute path of a project-relative `relative`, refused when it escapes the project or
 * traverses a symbolic link.
 */
async function projectPath(project: UiProject, relative: string): Promise<string> {
  if (path.isAbsolute(relative) || relative.split(/[\\/]/u).includes('..')) {
    throw new UiError('UI_LOCK_INVALID', 'Unsafe registry target: ' + relative)
  }
  const target = path.resolve(project.root, relative)
  projectRelative(project, target)
  let current = await realpath(project.root)
  for (const segment of path.relative(project.root, target).split(path.sep)) {
    current = path.join(current, segment)
    const stat = await lstat(current).catch(() => undefined)
    if (!stat) break
    if (stat.isSymbolicLink()) {
      throw new UiError('UI_LOCK_INVALID', 'Registry target traverses a symlink: ' + relative)
    }
  }
  return target
}
