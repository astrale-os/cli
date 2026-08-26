import { access, lstat, readFile } from 'node:fs/promises'
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

export async function discoverUiProject(input = process.cwd()): Promise<UiProject> {
  let root = path.resolve(input)
  if (!(await exists(root))) {
    throw new UiError('UI_PROJECT_UNSUPPORTED', 'Project path does not exist: ' + root)
  }
  if (!(await lstat(root)).isDirectory()) root = path.dirname(root)

  while (!(await exists(path.join(root, 'package.json')))) {
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
  let packageJson: Record<string, unknown>
  try {
    packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as Record<string, unknown>
  } catch (cause) {
    throw new UiError('UI_PROJECT_UNSUPPORTED', 'package.json is not valid JSON.', undefined, {
      cause,
    })
  }

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

  const cssCandidates = ['src/index.css', 'src/app.css', 'app/globals.css', 'src/styles.css']
  const resolvedCss = await Promise.all(
    cssCandidates.map(async (file) => ((await exists(path.join(root, file))) ? file : undefined)),
  )
  const cssRelative = resolvedCss.find(Boolean) ?? 'src/astrale-ui.css'

  return {
    root,
    packageJsonPath,
    packageJson,
    manager,
    lockPath,
    cssPath: path.join(root, cssRelative),
    componentsPath: path.join(root, 'components.json'),
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
