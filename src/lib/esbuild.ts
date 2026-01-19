/**
 * Shared esbuild configuration and plugins
 */

import type { BuildOptions, Plugin } from 'esbuild'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const sdksRoot = path.resolve(__dirname, '../../..')
const repoRoot = path.resolve(sdksRoot, '..')

export const WORKSPACE_PACKAGES: Record<string, string> = {
  '@astrale-os/sdk-worker': path.join(sdksRoot, 'worker/index.ts'),
  '@astrale-os/sdk-app': path.join(sdksRoot, 'app/index.ts'),
  '@astrale-os/shell-transport': path.join(repoRoot, 'shell/transport/src/index.ts'),
  '@astrale-os/shell-protocol': path.join(repoRoot, 'shell/protocol/src/index.ts'),
  '@astrale-os/shell-runtime': path.join(repoRoot, 'shell/runtime/index.ts'),
  '@astrale-os/shell-core': path.join(repoRoot, 'shell/core/src/index.ts'),
  '@astrale-os/kernel-core': path.join(repoRoot, 'kernel/core/index.ts'),
  '@astrale-os/kernel-client-ws': path.join(repoRoot, 'clients/kernel-ws-ts/src/index.ts'),
  '@astrale-os/datastore-client': path.join(repoRoot, 'clients/datastore-ts/src/index.ts'),
}

export function createWorkspaceResolverPlugin(
  packageMap: Record<string, string> = WORKSPACE_PACKAGES,
): Plugin {
  return {
    name: 'workspace-resolver',
    setup(build) {
      build.onResolve({ filter: /^@astrale\// }, (args) => {
        const resolved = packageMap[args.path]
        return resolved ? { path: resolved } : null
      })
    },
  }
}

export const workspaceResolverPlugin = createWorkspaceResolverPlugin

export interface WorkerBuildConfig {
  entryPath: string
  outFile: string
  minify: boolean
  sourcemap: boolean
  plugins?: Plugin[]
}

/**
 * Create base esbuild options for worker builds
 */
export function createWorkerBuildOptions(config: WorkerBuildConfig): BuildOptions {
  return {
    entryPoints: [config.entryPath],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: ['es2022'],
    outfile: config.outFile,
    minify: config.minify,
    sourcemap: config.sourcemap,
    define: {
      'process.env.NODE_ENV': config.minify ? '"production"' : '"development"',
    },
    metafile: true,
    plugins: [workspaceResolverPlugin(), ...(config.plugins ?? [])],
  }
}

/**
 * Extract bundle size from esbuild metafile
 */
export function getBundleSize(
  metafile: { outputs: Record<string, { bytes: number }> } | undefined,
): number {
  if (!metafile) return 0
  const outputs = Object.keys(metafile.outputs)
  const mainOutput = outputs.find((o) => o.endsWith('.js'))
  return mainOutput ? (metafile.outputs[mainOutput]?.bytes ?? 0) : 0
}

/**
 * Format bundle size for display
 */
export function formatSize(bytes: number): string {
  return `${(bytes / 1024).toFixed(2)} KB`
}
