import type { ApplicationId } from '@astrale-os/kernel-core'
import path from 'path'
import { loadAppDefinition, loadAppFromDirectory, type LoadedApp } from './app-loader'
import { type FullConfig, findProjectRoot, getConfigPath, loadFullConfig } from './config'

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

export async function loadProject(options: LoadProjectOptions = {}): Promise<ProjectContext> {
  const { requireConfig = true, loadApp = false, overrides = {}, appPath } = options
  const projectRoot = await findProjectRoot(process.cwd())
  if (!projectRoot && requireConfig) {
    console.error(
      `[astrale] No .astrale/config.json found.\n  Run 'astrale init' first, or use --no-deploy to skip kernel deployment.`,
    )
    process.exit(1)
  }
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
  if (loadApp) ctx.app = await loadAppDefinitionSafe(ctx.projectRoot, appPath)
  return ctx
}

async function loadAppDefinitionSafe(projectRoot: string, appPath?: string): Promise<LoadedApp> {
  try {
    if (appPath) return await loadAppDefinition(path.resolve(projectRoot, appPath))
    return await loadAppFromDirectory(projectRoot)
  } catch (err) {
    console.error(`[astrale] Failed to load app:`, err instanceof Error ? err.message : err)
    process.exit(1)
  }
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
