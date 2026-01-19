import type { ModuleId } from '@astrale-os/kernel-core'
import { Command } from 'commander'
import path from 'path'
import { findProjectRoot } from '../lib/config'
import { getActiveProfile, getProfileAuth, getProfileConfig } from '../lib/global-config'
import { runDev, type DevOptions } from './dev'
import { runInit, type InitOptions } from './init'

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
  profile?: string
}

export async function runStart(options: StartOptions): Promise<void> {
  const projectDir = process.cwd()
  const profileName = options.profile ?? (await getActiveProfile())
  const profile = await getProfileConfig(profileName)
  const auth = await getProfileAuth(profileName)
  if (!auth) {
    console.error(`[astrale] Not authenticated for profile "${profileName}".`)
    console.error(`  Run: astrale auth login`)
    process.exit(1)
  }
  console.log(`[astrale] Using profile: ${profileName}`)
  console.log(`  Kernel: ${profile.kernelWsUrl}`)
  const existingProject = await findProjectRoot(projectDir)
  if (!existingProject) {
    console.log('\n[astrale] No .astrale/config.json found, initializing...')
    const title = options.title || path.basename(projectDir)
    const initOptions: InitOptions = { title, profile: profileName, parentId: options.parentId }
    await runInit(initOptions)
    console.log('')
  } else {
    console.log(`[astrale] Found existing config at ${existingProject}`)
  }
  const devOptions: DevOptions = {
    entry: options.entry,
    outdir: options.outdir,
    outfile: options.outfile,
    profile: profileName,
    noDeploy: false,
    iframeEntry: options.iframeEntry,
    iframeHtml: options.iframeHtml,
    hostPort: options.hostPort,
    noServe: options.noServe,
  }
  await runDev(devOptions)
}

export const startCommand = new Command('start')
  .description('Start dev workflow: init if needed, then dev')
  .argument('<entry>', 'Worker entry file (e.g., src/worker.ts)')
  .option('--title <name>', 'Application title (defaults to directory name)')
  .option('--outdir <dir>', 'Output directory', 'dist')
  .option('--outfile <name>', 'Output filename', 'worker.js')
  .option('--profile <name>', 'Profile to use')
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
        profile: opts.profile,
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
