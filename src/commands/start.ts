/**
 * astrale start
 *
 * One-command dev workflow: loads env, inits if needed, then runs dev.
 */

import type { AvatarId, ModuleId } from '@astrale-os/kernel-core'
import { Command } from 'commander'
import { existsSync, readFileSync } from 'fs'
import path from 'path'

import { findProjectRoot } from '../lib/config'
import { runDev, type DevOptions } from './dev'
import { runInit, type InitOptions } from './init'

function loadDevEnv(projectDir: string): boolean {
  const envPaths = [
    path.join(projectDir, '.dev', 'kernel-dev-env.sh'),
    path.join(projectDir, '..', '.dev', 'kernel-dev-env.sh'),
    path.join(projectDir, '..', '..', '.dev', 'kernel-dev-env.sh'),
  ]
  for (const envPath of envPaths) {
    if (existsSync(envPath)) {
      const content = readFileSync(envPath, 'utf-8')
      const lines = content.split('\n')
      for (const line of lines) {
        const match = line.match(/^export\s+([A-Z_]+)=(.*)$/)
        if (match) {
          const [, key, value] = match
          if (key && value && !process.env[key]) {
            process.env[key] = value.replace(/^["']|["']$/g, '')
          }
        }
      }
      console.log(`[astrale] Loaded dev env from ${envPath}`)
      return true
    }
  }
  return false
}

export type StartOptions = {
  entry: string
  title?: string
  outdir: string
  outfile: string
  iframeEntry?: string
  iframeHtml?: string
  hostPort: number
  noServe: boolean
  parentId?: ModuleId
}

export async function runStart(options: StartOptions): Promise<void> {
  const projectDir = process.cwd()
  loadDevEnv(projectDir)
  const wsUrl = process.env.WS_URL
  const rpcUrl = process.env.RPC_URL
  const avatarId = process.env.AVATAR_ID
  const token = process.env.TOKEN
  if (!wsUrl || !rpcUrl || !avatarId || !token) {
    console.error('[astrale] Missing dev environment variables (WS_URL, RPC_URL, AVATAR_ID, TOKEN)')
    console.error('  Make sure .dev/kernel-dev-env.sh exists in a parent directory')
    console.error('  Or run: source ../../.dev/kernel-dev-env.sh')
    process.exit(1)
  }
  const existingProject = await findProjectRoot(projectDir)
  if (!existingProject) {
    console.log('[astrale] No .astrale/config.json found, initializing...')
    const title = options.title || path.basename(projectDir)
    const initOptions: InitOptions = {
      title,
      kernelUrl: wsUrl,
      kernelRpcUrl: rpcUrl,
      avatarId: avatarId as AvatarId,
      token,
      parentId: options.parentId,
    }
    await runInit(initOptions)
    console.log('')
  } else {
    console.log(`[astrale] Found existing config at ${existingProject}`)
  }
  const devOptions: DevOptions = {
    entry: options.entry,
    outdir: options.outdir,
    outfile: options.outfile,
    kernelUrl: wsUrl,
    noDeploy: false,
    iframeEntry: options.iframeEntry,
    iframeHtml: options.iframeHtml,
    hostPort: options.hostPort,
    noServe: options.noServe,
  }
  await runDev(devOptions)
}

export const startCommand = new Command('start')
  .description('Start dev workflow: load env, init if needed, then dev')
  .argument('<entry>', 'Worker entry file (e.g., src/worker.ts)')
  .option('--title <name>', 'Application title (defaults to directory name)')
  .option('--outdir <dir>', 'Output directory', 'dist')
  .option('--outfile <name>', 'Output filename', 'worker.js')
  .option('--iframe-entry <path>', 'Iframe entry file (e.g., src/window/index.tsx)')
  .option('--iframe-html <path>', 'Iframe HTML template')
  .option('--host-port <port>', 'Host app port', '7017')
  .option('--no-serve', 'Skip local dev servers')
  .option('--parent-id <id>', 'Parent module ID for init')
  .action(async (entry, opts) => {
    try {
      await runStart({
        entry,
        title: opts.title,
        outdir: opts.outdir,
        outfile: opts.outfile,
        iframeEntry: opts.iframeEntry,
        iframeHtml: opts.iframeHtml,
        hostPort: parseInt(opts.hostPort, 10),
        noServe: opts.serve === false,
        parentId: opts.parentId as ModuleId | undefined,
      })
    } catch (err) {
      console.error('[astrale] Start failed:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  })
