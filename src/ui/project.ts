import { access, lstat, readFile, realpath } from 'node:fs/promises'
import path from 'node:path'

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
