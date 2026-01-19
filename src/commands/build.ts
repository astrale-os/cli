import type { ApplicationId } from '@astrale-os/kernel-core'
import type { SerializedApp } from '@astrale-os/sdk-app'
import { Command } from 'commander'
import esbuild from 'esbuild'
import { mkdir, readFile } from 'fs/promises'
import { extractBootstrapData } from '../lib/app-loader'
import { type FullConfig } from '../lib/config'
import { createWorkerBuildOptions, formatSize, getBundleSize } from '../lib/esbuild'
import { createKernelClient } from '../lib/kernel'
import { loadProject, printProjectInfo, resolvePaths } from '../lib/project'

export type BuildOptions = {
  entry: string
  outdir: string
  outfile: string
  minify: boolean
  sourcemap: boolean
  appId?: ApplicationId
  profile?: string
  noDeploy: boolean
  production: boolean
}

export async function runBuild(options: BuildOptions): Promise<void> {
  const { entryPath, outPath, outFile } = resolvePaths(
    options.entry,
    options.outdir,
    options.outfile,
  )
  const shouldDeploy = !options.noDeploy
  const ctx = await loadProject({
    requireConfig: shouldDeploy,
    loadApp: shouldDeploy,
    overrides: { appId: options.appId, profile: options.profile },
  })
  if (shouldDeploy && ctx.config) printProjectInfo(ctx)
  await mkdir(outPath, { recursive: true })
  console.log(`\n[astrale] Building worker bundle...`)
  const result = await esbuild.build(
    createWorkerBuildOptions({
      entryPath,
      outFile,
      minify: options.minify,
      sourcemap: options.sourcemap,
    }),
  )
  const size = getBundleSize(result.metafile)
  console.log(`  Entry:  ${entryPath}`)
  console.log(`  Output: ${outFile}`)
  console.log(`  Size:   ${formatSize(size)}`)
  if (options.minify) console.log(`  Minified: yes`)
  if (options.sourcemap) console.log(`  Sourcemap: yes`)
  if (shouldDeploy && ctx.config && ctx.app) {
    console.log(`\n[astrale] Deploying to kernel...`)
    const client = await createKernelClient({
      kernelWsUrl: ctx.config.kernelWsUrl,
      datastoreUrl: ctx.config.datastoreUrl,
      avatarId: ctx.config.avatarId,
      accessToken: ctx.config.accessToken,
    })
    try {
      const { schema, workerUrl, uiUrl } = prepareDeploymentConfig(
        ctx.app.serialized,
        ctx.config,
        options.production,
      )
      const developResult = await client.develop(schema, {
        appId: ctx.config.appId,
        typesContainerId: ctx.config.typesContainerId,
        workerBundleId: ctx.config.workerBundleId,
        uiBundleId: ctx.config.uiBundleId,
        sourceBundleId: ctx.config.sourceBundleId,
        workerUrl,
        uiUrl,
        bootstrap: ctx.config.bootstrap,
        remoteAppdata: ctx.config.remoteAppdata,
        endpoints: ctx.config.endpoints,
      })
      console.log(`  Schema: developed${options.production ? ' (production mode)' : ''}`)
      if (developResult.workerBundleGrant && ctx.config.workerBundleId) {
        const workerCode = await readFile(outFile, 'utf-8')
        const uploadResult = await client.uploadWorkerBundle(ctx.config.workerBundleId, workerCode)
        console.log(`  Worker: ${formatSize(uploadResult.bytes)} uploaded`)
      }
      if (developResult.bootstrapDataGrants && developResult.bootstrapDataGrants.length > 0) {
        const bootstrapDataMap = extractBootstrapData(ctx.app.appdata)
        const bootstrapResult = await client.uploadBootstrapData(
          developResult.bootstrapDataGrants,
          bootstrapDataMap,
        )
        console.log(
          `  Bootstrap data: ${bootstrapResult.count} items (${formatSize(bootstrapResult.bytes)})`,
        )
      }
      console.log(`\n✓ Build complete`)
    } catch (err) {
      console.error(`\n✗ Deployment failed:`, err instanceof Error ? err.message : err)
      process.exit(1)
    } finally {
      client.disconnect()
    }
  } else {
    console.log(`\n✓ Bundle complete (deployment skipped)`)
  }
}

export const buildCommand = new Command('build')
  .description('Build and deploy worker bundle')
  .argument('<entry>', 'Worker entry file (e.g., src/worker.ts)')
  .option('--outdir <dir>', 'Output directory', 'dist')
  .option('--outfile <name>', 'Output filename', 'worker.js')
  .option('--minify', 'Minify the output', false)
  .option('--sourcemap', 'Generate sourcemap', false)
  .option('--app-id <id>', 'Override appId from .astrale/config.json')
  .option('--profile <name>', 'Profile to use')
  .option('--no-deploy', 'Skip kernel deployment (bundle only)')
  .option('--production', 'Production build (use datastore bundles instead of dev URLs)', false)
  .action(async (entry, opts) => {
    try {
      await runBuild({
        entry,
        outdir: opts.outdir,
        outfile: opts.outfile,
        minify: opts.minify,
        sourcemap: opts.sourcemap,
        appId: opts.appId as ApplicationId | undefined,
        profile: opts.profile,
        noDeploy: opts.deploy === false,
        production: opts.production,
      })
    } catch (err) {
      console.error('[astrale] Build failed:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  })

function prepareDeploymentConfig(
  originalSchema: SerializedApp,
  config: FullConfig,
  isProduction: boolean,
): { schema: SerializedApp; workerUrl?: string; uiUrl?: string } {
  if (isProduction) {
    const uiUrl =
      originalSchema.app.ui.mode === 'url' ? (config.uiUrl ?? originalSchema.app.ui.url) : undefined
    return {
      schema: {
        ...originalSchema,
        app: {
          ...originalSchema.app,
          worker: { mode: 'source' as const },
          ui: originalSchema.app.ui,
        },
      },
      workerUrl: undefined,
      uiUrl,
    }
  }
  return { schema: originalSchema, workerUrl: config.workerUrl, uiUrl: config.uiUrl }
}
