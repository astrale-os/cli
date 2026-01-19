import type { AvatarId, ApplicationId } from '@astrale-os/kernel-core'
import { Command } from 'commander'
import esbuild, { type BuildContext, type Plugin } from 'esbuild'
import { mkdir } from 'fs/promises'
import path from 'path'
import { generateApps } from '../lib/apps-generator'
import { deployToKernel, type DeployerState } from '../lib/deployer'
import { createDevServer, type DevServer } from '../lib/dev-server'
import { createWorkerBuildOptions, formatSize, getBundleSize } from '../lib/esbuild'
import { KernelClient } from '../lib/kernel'
import { loadProject, printProjectInfo, resolvePaths } from '../lib/project'

export type DevOptions = {
  entry: string
  outdir: string
  outfile: string
  appId?: ApplicationId
  profile?: string
  noDeploy: boolean
  iframeEntry?: string
  iframeHtml?: string
  hostPort: number
  noServe: boolean
  appPath?: string
}

const DEFAULT_HOST_PORT = 7017

interface DevState extends DeployerState {
  buildCount: number
  devServer: DevServer | null
}

function devPlugin(state: DevState): Plugin {
  return {
    name: 'dev-plugin',
    setup(build) {
      let startTime: number
      build.onStart(() => {
        startTime = performance.now()
      })
      build.onEnd(async (result) => {
        const duration = (performance.now() - startTime).toFixed(0)
        state.buildCount++
        if (result.errors.length > 0) {
          console.log(`\n✗ Build #${state.buildCount} failed (${duration}ms)`)
          return
        }
        const size = getBundleSize(result.metafile)
        console.log(`\n✓ Build #${state.buildCount} (${duration}ms) → ${formatSize(size)}`)
        await deployToKernel(state)
      })
    },
  }
}

export async function runDev(options: DevOptions): Promise<void> {
  const { entryPath, outPath, outFile } = resolvePaths(
    options.entry,
    options.outdir,
    options.outfile,
  )
  const shouldDeploy = !options.noDeploy
  const shouldServe = !options.noServe
  const ctx = await loadProject({
    requireConfig: shouldDeploy,
    loadApp: shouldDeploy,
    overrides: { appId: options.appId, profile: options.profile },
    appPath: options.appPath,
  })
  const state: DevState = {
    buildCount: 0,
    projectRoot: ctx.projectRoot,
    outFile,
    config: ctx.config,
    client: null,
    app: ctx.app,
    devServer: null,
    appPath: options.appPath,
    endpointMaps: {},
  }
  if (shouldDeploy && ctx.config) {
    printProjectInfo(ctx)
    console.log(`\n[astrale] Connecting to kernel...`)
    try {
      const client = new KernelClient({
        kernelWsUrl: ctx.config.kernelWsUrl,
        datastoreUrl: ctx.config.datastoreUrl,
        accessToken: ctx.config.accessToken,
        persistent: true,
        onDisconnect: (reason) => {
          console.log(`\n⚠ Kernel disconnected: ${reason}`)
          console.log(`  Reconnecting...`)
        },
      })
      await client.connect()
      const sessionInfo = client.getSessionInfo()
      if (!sessionInfo) throw new Error('Failed to get session info')
      const spaceId = ctx.config.spaceId
      if (!spaceId) throw new Error('No spaceId in config. Re-run: astrale init')
      const mapping = sessionInfo.avatarsAndSpaces.find((m) => m.spaceId === spaceId)
      if (!mapping) throw new Error(`Space ${spaceId} not found for this user`)
      client.setAvatarId(mapping.avatarId as AvatarId)
      state.client = client
      console.log(`  ✓ Connected`)
    } catch (err) {
      console.error(
        `[astrale] Failed to connect to kernel:`,
        err instanceof Error ? err.message : err,
      )
      console.log(`  Continuing without deployment...`)
    }
  }
  await mkdir(outPath, { recursive: true })
  if (shouldServe && ctx.config?.workerUrl) {
    console.log(`\n[astrale] Starting dev servers...`)
    const configPath = path.join(ctx.projectRoot, '.astrale', 'config.json')
    state.devServer = await createDevServer({
      workerUrl: ctx.config.workerUrl,
      uiUrl: ctx.config.uiUrl,
      hostPort: options.hostPort,
      workerOutFile: outFile,
      iframeEntry: options.iframeEntry,
      iframeHtml: options.iframeHtml,
      projectRoot: ctx.projectRoot,
      configPath,
      onWorkerChange: () => {},
    })
    await state.devServer.start()
    console.log(`\n🚀 Dev environment ready!`)
    console.log(`   Open ${state.devServer.hostUrl} in your browser\n`)
  } else if (shouldServe && !ctx.config?.workerUrl) {
    console.log(`\n[astrale] Skipping dev servers (no workerUrl in config)`)
  }
  console.log(`\n[astrale] Starting worker watcher...`)
  console.log(`  Entry:  ${entryPath}`)
  console.log(`  Output: ${outFile}`)
  if (state.client && state.app?.serialized.apps) {
    const declaredApps = state.app.serialized.apps
    if (Object.keys(declaredApps).length > 0) {
      console.log(`\n[astrale] Generating app APIs...`)
      const appsDir = path.join(state.projectRoot, '.astrale', 'apps')
      const appSlug = state.app.serialized.app.slug
      const appsResult = await generateApps(appSlug, declaredApps, state.client, appsDir)
      if (appsResult.generated.length > 0)
        console.log(`  ✓ Generated ${appsResult.generated.length} app API(s)`)
      if (appsResult.errors.length > 0)
        console.warn(`  ⚠ App API generation errors:`, appsResult.errors)
      state.endpointMaps = appsResult.endpointMaps
    }
  }
  console.log(`\nWatching for changes... (Ctrl+C to stop)\n`)
  const buildOptions = createWorkerBuildOptions({
    entryPath,
    outFile,
    minify: false,
    sourcemap: true,
    plugins: [devPlugin(state)],
  })
  const esbuildCtx: BuildContext = await esbuild.context({ ...buildOptions, logLevel: 'warning' })
  await esbuildCtx.rebuild()
  await esbuildCtx.watch()
  process.on('SIGINT', async () => {
    console.log('\n\nShutting down...')
    await esbuildCtx.dispose()
    await state.devServer?.stop()
    state.client?.disconnect()
    process.exit(0)
  })
}

export const devCommand = new Command('dev')
  .description('Start development server with hot reload')
  .argument('<entry>', 'Worker entry file (e.g., src/worker.ts)')
  .option('--outdir <dir>', 'Output directory', 'dist')
  .option('--outfile <name>', 'Output filename', 'worker.js')
  .option('--app-id <id>', 'Override appId from .astrale/config.json')
  .option('--app <path>', 'Path to app definition file (e.g., core/src/app.ts)')
  .option('--profile <name>', 'Profile to use')
  .option('--no-deploy', 'Skip kernel deployment (watch only)')
  .option('--iframe-entry <path>', 'Iframe entry file (e.g., src/window/index.tsx)')
  .option('--iframe-html <path>', 'Iframe HTML template')
  .option('--host-port <port>', 'Host app port', String(DEFAULT_HOST_PORT))
  .option('--no-serve', 'Skip local dev servers')
  .action(async (entry, opts) => {
    try {
      const hostPort = parseInt(opts.hostPort, 10)
      if (isNaN(hostPort) || hostPort < 1 || hostPort > 65535) {
        throw new Error(`Invalid port: ${opts.hostPort}. Must be a number between 1 and 65535.`)
      }
      await runDev({
        entry,
        outdir: opts.outdir,
        outfile: opts.outfile,
        appId: opts.appId as ApplicationId | undefined,
        appPath: opts.app,
        profile: opts.profile,
        noDeploy: opts.deploy === false,
        iframeEntry: opts.iframeEntry,
        iframeHtml: opts.iframeHtml,
        hostPort,
        noServe: opts.serve === false,
      })
    } catch (err) {
      console.error('[astrale] Dev failed:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  })
