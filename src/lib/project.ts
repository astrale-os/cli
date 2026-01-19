import type { ApplicationId } from '@astrale-os/kernel-core'
import path from 'path'
import { loadAppFromDirectory, type LoadedApp } from './app-loader'
import { findProjectRoot, getConfigPath, loadFullConfig, type FullConfig } from './config'

export interface ProjectContext {
  projectRoot: string
  config: FullConfig | null
  app: LoadedApp | null
}

export interface ConfigOverrides {
  appId?: ApplicationId
  profile?: string
}

export interface LoadProjectOptions {
  requireConfig?: boolean
  loadApp?: boolean
  overrides?: ConfigOverrides
  appPath?: string
}

export class ProjectNotFoundError extends Error {
  constructor() {
    super(
      `No .astrale/config.json found. Run 'astrale init' first, or use --no-deploy to skip kernel deployment.`,
    )
    this.name = 'ProjectNotFoundError'
  }
}

export class AppLoadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AppLoadError'
  }
}

export async function loadProject(options: LoadProjectOptions = {}): Promise<ProjectContext> {
  const { requireConfig = true, loadApp = false, overrides = {}, appPath } = options
  const projectRoot = await findProjectRoot(process.cwd())
  if (!projectRoot && requireConfig) throw new ProjectNotFoundError()
  const ctx: ProjectContext = { projectRoot: projectRoot ?? process.cwd(), config: null, app: null }
  if (projectRoot) {
    const fullConfig = await loadFullConfig(projectRoot, overrides.profile)
    ctx.config = {
      ...fullConfig,
      ...Object.fromEntries(
        Object.entries(overrides).filter(([k, v]) => v !== undefined && k !== 'profile'),
      ),
    }
  }
  if (loadApp) ctx.app = await loadAppFromDirectory(ctx.projectRoot, appPath)
  return ctx
}

export function printProjectInfo(ctx: ProjectContext): void {
  if (!ctx.config) return
  console.log(`[astrale] Config: ${getConfigPath(ctx.projectRoot)}`)
  console.log(`  App ID:  ${ctx.config.appId}`)
  console.log(`  Profile: ${ctx.config.profile}`)
  console.log(`  Kernel:  ${ctx.config.kernelWsUrl}`)
  if (ctx.app) console.log(`  App:     ${ctx.app.name} (${ctx.app.slug})`)
}

export interface ResolvedPaths {
  entryPath: string
  outPath: string
  outFile: string
}

export function resolvePaths(entry: string, outdir: string, outfile: string): ResolvedPaths {
  const entryPath = path.resolve(process.cwd(), entry)
  const outPath = path.resolve(process.cwd(), outdir)
  const outFile = path.join(outPath, outfile)
  return { entryPath, outPath, outFile }
}
