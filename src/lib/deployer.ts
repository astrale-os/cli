import type { AppDevelopResult } from '@astrale-os/kernel-api'
import { readFile } from 'fs/promises'
import path from 'path'
import {
  extractBootstrapData,
  loadAppDefinition,
  loadAppFromDirectory,
  type LoadedApp,
} from './app-loader'
import { generateApps, type EndpointMaps } from './apps-generator'
import { type FullConfig } from './config'
import { analyzeEndpointUsages } from './endpoint-usage-analyzer'
import { formatSize } from './esbuild'
import type { KernelClient } from './kernel'

export interface DeployerState {
  projectRoot: string
  outFile: string
  config: FullConfig | null
  client: KernelClient | null
  app: LoadedApp | null
  appPath?: string
  endpointMaps: EndpointMaps
}

export type DependencyAnalysis = {
  dependencies: Array<{ targetSlug: string; endpoint: string }>
  appsInfo: string
  errors: string[]
}

export async function loadApp(state: DeployerState): Promise<LoadedApp> {
  if (state.appPath) return loadAppDefinition(path.resolve(state.projectRoot, state.appPath))
  return loadAppFromDirectory(state.projectRoot)
}

export async function analyzeDependencies(state: DeployerState): Promise<DependencyAnalysis> {
  const result: DependencyAnalysis = { dependencies: [], appsInfo: '', errors: [] }
  const { app, client } = state
  if (!app || !client) return result
  const declaredApps = app.serialized.apps
  if (!declaredApps || Object.keys(declaredApps).length === 0) return result
  const appsDir = path.join(state.projectRoot, '.astrale', 'apps')
  const appsResult = await generateApps(app.serialized.app.slug, declaredApps, client, appsDir)
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

export type UploadStats = { workerBytes: number; bootstrapInfo: string; endpointDocsInfo: string }

export async function uploadArtifacts(
  state: DeployerState,
  result: AppDevelopResult,
): Promise<UploadStats> {
  const stats: UploadStats = { workerBytes: 0, bootstrapInfo: '', endpointDocsInfo: '' }
  const { client, config, app } = state
  if (!client || !config) return stats
  if (result.workerBundleGrant && config.workerBundleId) {
    const workerCode = await readFile(state.outFile, 'utf-8')
    const uploadResult = await client.uploadWorkerBundle(config.workerBundleId, workerCode)
    stats.workerBytes = uploadResult.bytes
  }
  if (result.bootstrapDataGrants && result.bootstrapDataGrants.length > 0 && app) {
    const bootstrapDataMap = extractBootstrapData(app.appdata)
    const bootstrapResult = await client.uploadBootstrapData(
      result.bootstrapDataGrants,
      bootstrapDataMap,
    )
    stats.bootstrapInfo = `, ${bootstrapResult.count} bootstrap items (${formatSize(bootstrapResult.bytes)})`
  }
  if (result.endpointGrants && result.endpointGrants.length > 0 && app) {
    const endpointDocsResult = await client.uploadEndpointDocs(
      result.endpointGrants,
      app.serialized.endpoints,
    )
    if (endpointDocsResult.count > 0)
      stats.endpointDocsInfo = `, ${endpointDocsResult.count} endpoint docs (${formatSize(endpointDocsResult.bytes)})`
  }
  return stats
}

export async function deployToKernel(state: DeployerState): Promise<void> {
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
