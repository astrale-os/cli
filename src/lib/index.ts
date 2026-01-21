// App loading
export { loadAppDefinition, loadAppFromDirectory, type LoadedApp } from './app-loader'

// CLI utilities
export { withKernelClient, type ClientContext, type WithClientOptions } from './cli-utils'

// Deployer
export {
  analyzeDependencies,
  deployToKernel,
  type DeployerState,
  type DependencyAnalysis,
  loadApp,
  uploadArtifacts,
  type UploadStats,
} from './deployer'

// Config
export {
  type AstraleConfig,
  type FullConfig,
  findProjectRoot,
  getConfigPath,
  loadConfig,
  loadFullConfig,
  saveConfig,
} from './config'

// Dev Server
export { createDevServer, type DevServer, type DevServerConfig } from './dev-server'

// Esbuild
export {
  createWorkerBuildOptions,
  createWorkspaceResolverPlugin,
  formatSize,
  getBundleSize,
  type WorkerBuildConfig,
  WORKSPACE_PACKAGES,
  workspaceResolverPlugin,
} from './esbuild'

// Kernel
export {
  type AppBuildResult,
  type AppCreateResult,
  type AppDevelopResult,
  createKernelClient,
  KernelClient,
  type KernelClientConfig,
} from './kernel'

// Project
export {
  AppLoadError,
  type ConfigOverrides,
  loadProject,
  type LoadProjectOptions,
  printProjectInfo,
  type ProjectContext,
  ProjectNotFoundError,
  type ResolvedPaths,
  resolvePaths,
} from './project'
