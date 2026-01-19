import type { ApplicationId } from '@astrale-os/kernel-core'
import type { AppDevelopResult } from '@astrale-os/kernel-api'
import { Command } from 'commander'
import esbuild, { type BuildContext, type Plugin } from 'esbuild'
import { mkdir, readFile } from 'fs/promises'
import path from 'path'
import {
  extractBootstrapData,
  loadAppDefinition,
  loadAppFromDirectory,
  type LoadedApp,
} from '../lib/app-loader'
import { generateApps, type EndpointMaps } from '../lib/apps-generator'
import { analyzeEndpointUsages } from '../lib/endpoint-usage-analyzer'
import { type FullConfig } from '../lib/config'
import { createDevServer, type DevServer } from '../lib/dev-server'
import { createWorkerBuildOptions, formatSize, getBundleSize } from '../lib/esbuild'
import { createKernelClient, type KernelClient } from '../lib/kernel'
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

let buildCount = 0

interface DevState {
  projectRoot: string
  outFile: string
  config: FullConfig | null
  client: KernelClient | null
  app: LoadedApp | null
  devServer: DevServer | null
  appPath?: string
  endpointMaps: EndpointMaps
}

async function loadApp(state: DevState): Promise<LoadedApp> {
  if (state.appPath) return loadAppDefinition(path.resolve(state.projectRoot, state.appPath))
  return loadAppFromDirectory(state.projectRoot)
}

type DependencyAnalysis = {
  dependencies: Array<{ targetSlug: string; endpoint: string }>
  appsInfo: string
  errors: string[]
}

async function analyzeDependencies(state: DevState): Promise<DependencyAnalysis> {
  const result: DependencyAnalysis = { dependencies: [], appsInfo: '', errors: [] }
  const declaredApps = state.app?.serialized.apps
  if (!declaredApps || Object.keys(declaredApps).length === 0 || !state.client) return result
  const appsDir = path.join(state.projectRoot, '.astrale', 'apps')
  const appSlug = state.app!.serialized.app.slug
  const appsResult = await generateApps(appSlug, declaredApps, state.client, appsDir)
  if (appsResult.generated.length > 0)
    result.appsInfo = `, ${appsResult.generated.length} app APIs generated`
  result.errors.push(...appsResult.errors)
  state.endpointMaps = appsResult.endpointMaps
  const analysis = analyzeEndpointUsages(state.projectRoot, appsResult.endpointMaps, declaredApps)
  result.dependencies = analysis.usages.map((u) => ({
    targetSlug: u.targetSlug,
    endpoint: u.endpoint,
  }))
  result.errors.push(...analysis.errors)
  if (result.dependencies.length > 0)
    result.appsInfo += `, ${result.dependencies.length} cross-app calls detected`
  return result
}

type UploadStats = { workerBytes: number; bootstrapInfo: string; endpointDocsInfo: string }

async function uploadArtifacts(state: DevState, result: AppDevelopResult): Promise<UploadStats> {
  const stats: UploadStats = { workerBytes: 0, bootstrapInfo: '', endpointDocsInfo: '' }
  if (result.workerBundleGrant && state.config?.workerBundleId) {
    const workerCode = await readFile(state.outFile, 'utf-8')
    const uploadResult = await state.client!.uploadWorkerBundle(
      state.config.workerBundleId,
      workerCode,
    )
    stats.workerBytes = uploadResult.bytes
  }
  if (result.bootstrapDataGrants && result.bootstrapDataGrants.length > 0 && state.app) {
    const bootstrapDataMap = extractBootstrapData(state.app.appdata)
    const bootstrapResult = await state.client!.uploadBootstrapData(
      result.bootstrapDataGrants,
      bootstrapDataMap,
    )
    stats.bootstrapInfo = `, ${bootstrapResult.count} bootstrap items (${formatSize(bootstrapResult.bytes)})`
  }
  if (result.endpointGrants && result.endpointGrants.length > 0 && state.app) {
    const endpointDocsResult = await state.client!.uploadEndpointDocs(
      result.endpointGrants,
      state.app.serialized.endpoints,
    )
    if (endpointDocsResult.count > 0)
      stats.endpointDocsInfo = `, ${endpointDocsResult.count} endpoint docs (${formatSize(endpointDocsResult.bytes)})`
  }
  return stats
}

async function deployToKernel(state: DevState): Promise<void> {
  if (!state.client || !state.config) return
  try {
    state.app = await loadApp(state)
    const { dependencies, appsInfo, errors } = await analyzeDependencies(state)
    for (const error of errors) console.warn(`  ⚠ ${error}`)
    const result = await state.client.develop(state.app.serialized, {
      appId: state.config.appId,
      typesContainerId: state.config.typesContainerId,
      workerBundleId: state.config.workerBundleId,
      uiBundleId: state.config.uiBundleId,
      sourceBundleId: state.config.sourceBundleId,
      workerUrl: state.config.workerUrl,
      uiUrl: state.config.uiUrl,
      bootstrap: state.config.bootstrap,
      remoteAppdata: state.config.remoteAppdata,
      endpoints: state.config.endpoints,
      dependencies,
    })
    const stats = await uploadArtifacts(state, result)
    console.log(
      `  ↑ Deployed (${formatSize(stats.workerBytes)} worker${stats.bootstrapInfo}${stats.endpointDocsInfo}${appsInfo})`,
    )
  } catch (err) {
    console.error(`  ⚠ Deploy failed:`, err instanceof Error ? err.message : err)
  }
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
        buildCount++
        if (result.errors.length > 0) {
          console.log(`\n✗ Build #${buildCount} failed (${duration}ms)`)
          return
        }
        const size = getBundleSize(result.metafile)
        console.log(`\n✓ Build #${buildCount} (${duration}ms) → ${formatSize(size)}`)
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
      state.client = await createKernelClient({
        kernelWsUrl: ctx.config.kernelWsUrl,
        datastoreUrl: ctx.config.datastoreUrl,
        avatarId: ctx.config.avatarId,
        token: ctx.config.token,
        persistent: true,
        onDisconnect: (reason) => {
          console.log(`\n⚠ Kernel disconnected: ${reason}`)
          console.log(`  Reconnecting...`)
        },
      })
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
  .option('--host-port <port>', 'Host app port', '7017')
  .option('--no-serve', 'Skip local dev servers')
  .action(async (entry, opts) => {
    try {
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
        hostPort: parseInt(opts.hostPort, 10),
        noServe: opts.serve === false,
      })
    } catch (err) {
      console.error('[astrale] Dev failed:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  })
