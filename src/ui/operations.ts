import { access, lstat, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { isSeq, parseDocument } from 'yaml'

import { digest, parseUiLock, readUiLock } from './lock'
import {
  UI_PACKAGE,
  UI_PRESETS,
  UiError,
  type UiLock,
  type UiPreset,
  type UiRegistryItem,
  type UiRelease,
} from './model'
import {
  assertSupportedUiProject,
  discoverUiProject,
  projectRelative,
  type UiProject,
} from './project'
import {
  readUiRegistryItem,
  readUiReleaseSnapshot,
  registryItemUrl,
  resolveUiRelease,
} from './release'
import { defaultUiRunner, shadcnInvocation, type UiRunner } from './runner'

type Dependencies = { fetcher?: typeof fetch; runner?: UiRunner }

async function exists(target: string): Promise<boolean> {
  return access(target).then(
    () => true,
    () => false,
  )
}

async function readOptional(target: string): Promise<string | undefined> {
  return readFile(target, 'utf8').catch(() => undefined)
}

function manifestDependencies(manifest: Record<string, unknown>): Record<string, string> {
  return { ...(manifest.dependencies as Record<string, string> | undefined) }
}

function domainRegistryPackagePath(project: UiProject): string {
  return path.join(project.root, 'components/package.json')
}

function pnpmWorkspacePath(project: UiProject): string {
  return path.join(project.root, 'pnpm-workspace.yaml')
}

function domainRegistryPackageName(manifest: Record<string, unknown>): string {
  const name = typeof manifest.name === 'string' ? manifest.name : 'astrale-domain'
  return name + '-ui-registry'
}

function appendWorkspace(manifest: Record<string, unknown>, workspace: string): void {
  const configured = manifest.workspaces
  if (configured === undefined) {
    manifest.workspaces = [workspace]
    return
  }
  if (Array.isArray(configured) && configured.every((value) => typeof value === 'string')) {
    if (!configured.includes(workspace)) manifest.workspaces = [...configured, workspace]
    return
  }
  if (configured && typeof configured === 'object') {
    const candidate = configured as { packages?: unknown }
    if (
      Array.isArray(candidate.packages) &&
      candidate.packages.every((value) => typeof value === 'string')
    ) {
      if (!candidate.packages.includes(workspace)) {
        manifest.workspaces = { ...candidate, packages: [...candidate.packages, workspace] }
      }
      return
    }
  }
  throw new UiError('UI_PROJECT_UNSUPPORTED', 'package.json has an invalid workspaces field.')
}

async function appendPnpmWorkspace(project: UiProject, workspace: string): Promise<void> {
  const target = pnpmWorkspacePath(project)
  const source = await readOptional(target)
  if (source === undefined) {
    await writeFile(target, "packages:\n  - '" + workspace + "'\n", 'utf8')
    return
  }
  const document = parseDocument(source)
  if (document.errors.length > 0) {
    throw new UiError('UI_PROJECT_UNSUPPORTED', 'pnpm-workspace.yaml is not valid YAML.')
  }
  const packages = document.get('packages', true)
  if (!isSeq(packages)) {
    throw new UiError(
      'UI_PROJECT_UNSUPPORTED',
      'pnpm-workspace.yaml must declare a packages sequence.',
    )
  }
  const values = packages.toJSON()
  if (!Array.isArray(values) || !values.every((value) => typeof value === 'string')) {
    throw new UiError(
      'UI_PROJECT_UNSUPPORTED',
      'pnpm-workspace.yaml must declare a packages sequence.',
    )
  }
  if (!values.includes(workspace)) packages.add(workspace)
  await writeFile(target, String(document), 'utf8')
}

async function hasDomainRegistryWorkspace(project: UiProject): Promise<boolean> {
  if (!project.isAstraleDomain || !(await exists(domainRegistryPackagePath(project)))) return false
  const registryManifest = JSON.parse(
    await readFile(domainRegistryPackagePath(project), 'utf8'),
  ) as Record<string, unknown>
  if (
    registryManifest.private !== true ||
    typeof registryManifest.name !== 'string' ||
    registryManifest.name === UI_PACKAGE ||
    registryManifest.name === project.packageJson.name
  ) {
    return false
  }
  if (project.manager === 'pnpm') {
    const source = await readOptional(pnpmWorkspacePath(project))
    if (source === undefined) return false
    const document = parseDocument(source)
    if (document.errors.length > 0) return false
    const packages = document.get('packages', true)
    const values = isSeq(packages) ? packages.toJSON() : undefined
    return Array.isArray(values) && values.includes('components')
  }
  const configured = project.packageJson.workspaces
  const workspaces = Array.isArray(configured)
    ? configured
    : configured && typeof configured === 'object'
      ? (configured as { packages?: unknown }).packages
      : undefined
  return Array.isArray(workspaces) && workspaces.includes('components')
}

async function writeDomainRegistryWorkspace(
  project: UiProject,
  manifest: Record<string, unknown>,
): Promise<void> {
  if (!project.isAstraleDomain) return
  if (project.manager === 'pnpm') await appendPnpmWorkspace(project, 'components')
  else appendWorkspace(manifest, 'components')
  const target = domainRegistryPackagePath(project)
  const existing = await readOptional(target)
  const registryManifest = existing
    ? (JSON.parse(existing) as Record<string, unknown>)
    : { name: domainRegistryPackageName(manifest) }
  if (registryManifest.private === false) {
    throw new UiError(
      'UI_PROJECT_UNSUPPORTED',
      'The Astrale registry source workspace must remain private.',
    )
  }
  if (
    registryManifest.name === UI_PACKAGE ||
    registryManifest.name === manifest.name ||
    (registryManifest.name !== undefined && typeof registryManifest.name !== 'string')
  ) {
    throw new UiError(
      'UI_PROJECT_UNSUPPORTED',
      'The Astrale registry source workspace must have a distinct package name.',
    )
  }
  await writeJson(target, {
    ...registryManifest,
    name: registryManifest.name ?? domainRegistryPackageName(manifest),
    private: true,
    type: registryManifest.type ?? 'module',
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

export async function initUi(
  options: InitUiOptions,
  dependencies: Dependencies = {},
): Promise<Record<string, unknown>> {
  const project = await discoverUiProject(options.path)
  assertSupportedUiProject(project)
  const preset = options.preset ?? 'astrale'
  if (!UI_PRESETS.includes(preset)) {
    throw new UiError('UI_PROJECT_UNSUPPORTED', 'Unknown UI preset: ' + preset)
  }
  if ((await exists(project.uiLockPath)) && !options.force) {
    const lock = await readUiLock(project.uiLockPath)
    const css = (await readOptional(project.cssPath)) ?? ''
    const components = await readOptional(project.componentsPath)
      .then((value) => (value ? (JSON.parse(value) as Record<string, unknown>) : undefined))
      .catch(() => undefined)
    const requestedVersion = options.version?.replace(/^v/u, '')
    const desired =
      (!requestedVersion || requestedVersion === lock.package.version) &&
      (!options.preset || options.preset === lock.preset) &&
      css.includes(UI_PACKAGE + '/theme.css') &&
      css.includes(UI_PACKAGE + '/presets/' + lock.preset + '.css') &&
      components?.style === 'base-nova' &&
      (!project.isAstraleDomain || (await hasDomainRegistryWorkspace(project)))
    if (!desired) {
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
  const plan = {
    status: options.dryRun ? 'planned' : 'initialized',
    root: project.root,
    package: UI_PACKAGE + '@' + release.version,
    manager: project.manager,
    preset,
    files: [
      'package.json',
      cssRelative,
      'components.json',
      'astrale-ui.lock.json',
      ...(project.isAstraleDomain ? ['components/package.json'] : []),
      ...(project.isAstraleDomain && project.manager === 'pnpm' ? ['pnpm-workspace.yaml'] : []),
      ...(project.lockPath ? [projectRelative(project, project.lockPath)] : []),
    ],
    tooling: {
      shadcn: release.compatibility.shadcn,
      base: release.compatibility.base,
      style: release.compatibility.style,
      baseUi: release.compatibility.baseUi,
    },
  }
  if (options.dryRun) return plan

  if (project.isAstraleDomain) {
    await assertSafePlannedTarget(project, 'components/package.json')
    if (project.manager === 'pnpm') {
      await assertSafePlannedTarget(project, 'pnpm-workspace.yaml')
    }
  }

  const mutationPaths = [
    project.packageJsonPath,
    project.cssPath,
    project.componentsPath,
    project.uiLockPath,
    ...(project.isAstraleDomain ? [domainRegistryPackagePath(project)] : []),
    ...(project.isAstraleDomain && project.manager === 'pnpm' ? [pnpmWorkspacePath(project)] : []),
    ...(project.lockPath ? [project.lockPath] : []),
  ]
  const snapshots = new Map<string, string | undefined>()
  for (const target of mutationPaths) snapshots.set(target, await readOptional(target))

  try {
    const manifest = { ...project.packageJson }
    manifest.dependencies = {
      ...manifestDependencies(manifest),
      [UI_PACKAGE]: release.version,
    }
    await writeDomainRegistryWorkspace(project, manifest)
    await writeJson(project.packageJsonPath, manifest)

    const currentCss = (await readOptional(project.cssPath)) ?? ''
    const imports = [
      "@import '" + UI_PACKAGE + "/theme.css';",
      "@import '" + UI_PACKAGE + '/presets/' + preset + ".css';",
    ]
    const withoutAstrale = currentCss
      .replace(
        /^@import\s+['"]@astrale-os\/ui\/(?:theme\.css|presets\/[a-z-]+\.css)['"];?\s*$/gmu,
        '',
      )
      .trimStart()
    await mkdir(path.dirname(project.cssPath), { recursive: true })
    await writeFile(project.cssPath, imports.join('\n') + '\n\n' + withoutAstrale, 'utf8')

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
      const result = await (dependencies.runner ?? defaultUiRunner)(
        project.manager,
        ['install'],
        project.root,
      )
      if (result.code !== 0) {
        throw new UiError(
          'UI_DEPENDENCY_INSTALL_FAILED',
          project.manager + ' install failed.',
          result.stderr.trim() || undefined,
        )
      }
    }

    const lock: UiLock = {
      $schema:
        'https://raw.githubusercontent.com/astrale-os/ui/' +
        release.ref +
        '/schemas/ui-lock.schema.json',
      version: 1,
      package: { name: UI_PACKAGE, version: release.version },
      registry: {
        repository: 'astrale-os/ui',
        ref: release.ref,
        commit: release.commit,
      },
      tooling: {
        shadcn: release.compatibility.shadcn,
        base: 'base',
        style: 'nova',
        baseUi: release.compatibility.baseUi,
      },
      preset,
      items: {},
    }
    await writeJson(project.uiLockPath, lock)
    return { ...plan, lock }
  } catch (error) {
    for (const [target, value] of snapshots) {
      if (value !== undefined) await writeFile(target, value, 'utf8')
      else await rm(target, { force: true })
    }
    throw error
  }
}

async function pinUiDependency(
  project: UiProject,
  version: string,
  runner: UiRunner,
): Promise<void> {
  const manifest = JSON.parse(await readFile(project.packageJsonPath, 'utf8')) as Record<
    string,
    unknown
  >
  if (manifestDependencies(manifest)[UI_PACKAGE] === version) return
  manifest.dependencies = { ...manifestDependencies(manifest), [UI_PACKAGE]: version }
  await writeJson(project.packageJsonPath, manifest)
  const result = await runner(project.manager, ['install'], project.root)
  if (result.code !== 0) {
    throw new UiError(
      'UI_DEPENDENCY_INSTALL_FAILED',
      project.manager + ' install failed while restoring the locked UI release.',
      result.stderr.trim() || undefined,
    )
  }
}

export async function listUi(
  query: string | undefined,
  options: { type?: string; limit?: number; version?: string },
  dependencies: Dependencies = {},
): Promise<UiRegistryItem[]> {
  const release = await resolveUiRelease(options.version, dependencies.fetcher)
  const needle = query?.trim().toLowerCase()
  return release.registry.items
    .filter((item) => {
      if (options.type && !item.meta.canonicalAddress.startsWith(options.type + '/')) return false
      if (!needle) return true
      return [item.meta.canonicalAddress, item.name, item.title, item.description]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle))
    })
    .slice(0, options.limit ?? 100)
}

export async function listLockedUi(
  input: string | undefined,
  dependencies: Dependencies = {},
): Promise<UiRegistryItem[]> {
  const project = await discoverUiProject(input)
  const { release } = await lockedRelease(project, dependencies.fetcher)
  return release.registry.items
}

async function lockedRelease(
  project: UiProject,
  fetcher?: typeof fetch,
): Promise<{ lock: UiLock; release: UiRelease }> {
  const lock = await readUiLock(project.uiLockPath)
  const release = await readUiReleaseSnapshot(
    {
      version: lock.package.version,
      ref: lock.registry.ref,
      commit: lock.registry.commit,
    },
    fetcher,
  )
  return { lock, release }
}

export async function addUi(
  addresses: string[],
  options: { project?: string; dryRun?: boolean; overwrite?: boolean; yes?: boolean },
  dependencies: Dependencies = {},
): Promise<Record<string, unknown>> {
  if (addresses.length === 0) {
    throw new UiError('UI_ITEM_NOT_FOUND', 'No UI item was provided.')
  }
  const project = await discoverUiProject(options.project)
  const { lock, release } = await lockedRelease(project, dependencies.fetcher)
  const items = addresses.map((address) => findItem(release, address))
  const itemDocuments = await Promise.all(
    items.map((item) => readUiRegistryItem(release, item, dependencies.fetcher)),
  )
  if (options.overwrite && !options.yes) {
    throw new UiError(
      'UI_LOCAL_CHANGES',
      'Replacing installed UI source requires explicit confirmation.',
      'Review the locally edited files, then repeat with both --overwrite and --yes.',
    )
  }
  await rejectLocalChanges(project, lock, items, options.overwrite === true)
  const targets = (
    await Promise.all(
      items.flatMap((item) =>
        item.files
          .filter((file) => file.target)
          .map((file) => assertSafePlannedTarget(project, file.target!)),
      ),
    )
  ).filter((target, index, all) => all.indexOf(target) === index)
  const invocation = shadcnInvocation(project.manager, release.compatibility.shadcn, [
    'add',
    ...items.map((item) => registryItemUrl(release, item.name)),
    '--cwd',
    project.root,
    ...(options.dryRun ? ['--dry-run'] : []),
    ...(options.overwrite ? ['--overwrite'] : []),
    ...(options.yes ? ['--yes'] : []),
  ])
  const snapshots = new Map<string, string | undefined>()
  if (!options.dryRun) {
    for (const target of [project.packageJsonPath, project.lockPath!, ...targets]) {
      snapshots.set(target, await readOptional(target))
    }
  }
  let result: Awaited<ReturnType<UiRunner>>
  try {
    result = await (dependencies.runner ?? defaultUiRunner)(
      invocation.file,
      invocation.args,
      project.root,
    )
    if (result.code !== 0) {
      throw new UiError(
        'UI_TOOL_FAILED',
        'The pinned shadcn operation failed.',
        result.stderr.trim(),
      )
    }
    if (!options.dryRun) {
      for (const target of targets) {
        if (!(await exists(target))) {
          throw new UiError('UI_TOOL_FAILED', 'The pinned shadcn operation omitted an item file.')
        }
      }
      await pinUiDependency(project, lock.package.version, dependencies.runner ?? defaultUiRunner)
    }
  } catch (error) {
    for (const [target, previous] of snapshots) {
      if (previous === undefined) await rm(target, { force: true })
      else await writeFile(target, previous, 'utf8')
    }
    throw error
  }
  if (options.dryRun) {
    return {
      status: 'planned',
      items: items.map((item) => item.meta.canonicalAddress),
      sources: itemDocuments.map((item) => ({
        address: item.meta.canonicalAddress,
        dependencies: item.dependencies ?? [],
        files: item.files.map((file) => file.target).filter(Boolean),
      })),
      command: [invocation.file, ...invocation.args],
      output: result.stdout,
    }
  }

  try {
    for (const [index, item] of items.entries()) {
      const itemDocument = itemDocuments[index]!
      const files: Record<string, string> = {}
      for (const file of item.files) {
        if (!file.target) continue
        const target = await safeTarget(project, file.target)
        files[projectRelative(project, target)] = digest(await readFile(target))
      }
      lock.items[item.meta.canonicalAddress] = {
        address: item.meta.canonicalAddress,
        sourceDigest: digest(JSON.stringify(itemDocument)),
        files,
      }
    }
    await writeJson(project.uiLockPath, lock)
  } catch (error) {
    for (const [target, previous] of snapshots) {
      if (previous === undefined) await rm(target, { force: true })
      else await writeFile(target, previous, 'utf8')
    }
    throw error
  }
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
}

export async function doctorUi(
  input?: string,
): Promise<{ healthy: boolean; checks: Array<{ check: string; ok: boolean; detail?: string }> }> {
  const project = await discoverUiProject(input)
  const checks: Array<{ check: string; ok: boolean; detail?: string }> = []
  let lock: UiLock | undefined
  try {
    lock = parseUiLock(JSON.parse(await readFile(project.uiLockPath, 'utf8')))
    checks.push({ check: 'lock', ok: true })
  } catch (error) {
    checks.push({
      check: 'lock',
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    })
  }
  const dependencies = manifestDependencies(project.packageJson)
  checks.push({
    check: 'package',
    ok: typeof dependencies[UI_PACKAGE] === 'string',
    detail: dependencies[UI_PACKAGE],
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
        const actual = await readFile(path.join(project.root, file))
          .then(digest)
          .catch(() => '')
        checks.push({ check: 'item:' + item.address + ':' + file, ok: actual === expected })
      }
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
  const lock = await readUiLock(project.uiLockPath)
  const css = (await readOptional(project.cssPath)) ?? ''
  const next = css.replace(
    /@astrale-os\/ui\/presets\/[a-z-]+\.css/gu,
    '@astrale-os/ui/presets/' + preset + '.css',
  )
  if (next === css && !css.includes('@astrale-os/ui/presets/')) {
    throw new UiError('UI_CONFIG_MISSING', 'No Astrale preset import was found.')
  }
  if (!options.dryRun) {
    await writeFile(project.cssPath, next, 'utf8')
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
      : 'Run astrale ui list to discover canonical addresses.',
  )
}

async function rejectLocalChanges(
  project: UiProject,
  lock: UiLock,
  items: UiRegistryItem[],
  overwrite: boolean,
): Promise<void> {
  if (overwrite) return
  for (const item of items) {
    const installed = lock.items[item.meta.canonicalAddress]
    if (!installed) continue
    for (const [file, expected] of Object.entries(installed.files)) {
      const actual = await readFile(path.join(project.root, file))
        .then(digest)
        .catch(() => '')
      if (actual !== expected) {
        throw new UiError(
          'UI_LOCAL_CHANGES',
          'Installed UI file has local changes: ' + file,
          'Review the file, then repeat add with explicit --overwrite --yes.',
        )
      }
    }
  }
}

async function safeTarget(project: UiProject, relative: string): Promise<string> {
  if (path.isAbsolute(relative) || relative.split(/[\\/]/u).includes('..')) {
    throw new UiError('UI_LOCK_INVALID', 'Unsafe registry target: ' + relative)
  }
  const target = path.resolve(project.root, relative)
  projectRelative(project, target)
  const parent = await realpath(path.dirname(target))
  const root = await realpath(project.root)
  if (parent !== root && !parent.startsWith(root + path.sep)) {
    throw new UiError('UI_LOCK_INVALID', 'Registry target escapes through a symlink: ' + relative)
  }
  if ((await exists(target)) && (await lstat(target)).isSymbolicLink()) {
    throw new UiError('UI_LOCK_INVALID', 'Registry target is a symlink: ' + relative)
  }
  return target
}

async function assertSafePlannedTarget(project: UiProject, relative: string): Promise<string> {
  if (path.isAbsolute(relative) || relative.split(/[\\/]/u).includes('..')) {
    throw new UiError('UI_LOCK_INVALID', 'Unsafe registry target: ' + relative)
  }
  const target = path.resolve(project.root, relative)
  projectRelative(project, target)
  const root = await realpath(project.root)
  const physicalTarget = path.resolve(root, path.relative(project.root, target))
  let current = root
  for (const segment of path.relative(root, physicalTarget).split(path.sep)) {
    current = path.join(current, segment)
    if (!(await exists(current))) break
    if ((await lstat(current)).isSymbolicLink()) {
      throw new UiError('UI_LOCK_INVALID', 'Registry target traverses a symlink: ' + relative)
    }
  }
  return target
}

async function writeJson(target: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, JSON.stringify(value, null, 2) + '\n', 'utf8')
}
