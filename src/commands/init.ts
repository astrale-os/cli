import type { ModuleId } from '@astrale-os/kernel-core'
import { Command } from 'commander'
import { type AstraleConfig, getConfigPath, saveConfig } from '../lib/config'
import { generateAppKeyPair } from '../lib/crypto'
import { resolveConfig } from '../lib/global-config'
import { createKernelClient } from '../lib/kernel'

export type InitOptions = {
  title?: string
  profile?: string
  parentId?: ModuleId
}

export async function runInit(options: InitOptions): Promise<void> {
  console.log(`[astrale] Initializing new application...`)
  if (options.title) console.log(`  Title: ${options.title}`)
  const resolved = await resolveConfig(options.profile)
  console.log(`  Profile: ${resolved.profile}`)
  console.log(`  Kernel WS: ${resolved.kernelWsUrl}`)
  console.log(`  Kernel RPC: ${resolved.kernelRpcUrl}`)
  console.log(`  Avatar: ${resolved.avatarId}`)
  console.log(`\n[astrale] Generating app keypair...`)
  const keyPair = await generateAppKeyPair()
  console.log(`  ✓ Keypair generated (ECDSA P-256)`)
  console.log(`\n[astrale] Connecting to kernel...`)
  const client = await createKernelClient({
    kernelWsUrl: resolved.kernelWsUrl,
    avatarId: resolved.avatarId,
    accessToken: resolved.accessToken,
  })
  try {
    const parentId = options.parentId ?? resolved.avatarId
    if (!parentId)
      throw new Error('Parent ID is required. Use --parent-id to specify where to create the app.')
    console.log(`[astrale] Creating application...`)
    const result = await client.createApp(parentId, undefined, keyPair.publicKeyJwk)
    console.log(`  ✓ Application created`)
    console.log(`  App ID: ${result.appId}`)
    console.log(`  Worker URL: ${result.workerUrl}`)
    console.log(`  UI URL: ${result.uiUrl}`)
    const config: AstraleConfig = {
      appId: result.appId,
      profile: resolved.profile,
      typesContainerId: result.typesContainerId,
      workerBundleId: result.workerBundleId,
      uiBundleId: result.uiBundleId,
      sourceBundleId: result.sourceBundleId,
      workerUrl: result.workerUrl,
      uiUrl: result.uiUrl,
      bootstrap: result.bootstrap,
      remoteAppdata: result.remoteAppdata,
      endpoints: result.endpoints,
      privateKey: keyPair.privateKeyPem,
    }
    const projectDir = process.cwd()
    await saveConfig(projectDir, config)
    console.log(`\n✓ Config saved to ${getConfigPath(projectDir)}`)
    console.log(`\nNext steps:`)
    console.log(`  1. Run 'astrale build' to build and deploy`)
    console.log(`  2. Run 'astrale dev' for hot-reload development`)
  } finally {
    client.disconnect()
  }
}

export const initCommand = new Command('init')
  .description('Initialize a new Astrale app in the kernel')
  .option('--title <name>', 'Application title (for display only)')
  .option('--profile <name>', 'Profile to use (default: active profile)')
  .option('--parent-id <id>', 'Parent module ID (defaults to avatar)')
  .action(async (opts) => {
    try {
      await runInit({
        title: opts.title,
        profile: opts.profile,
        parentId: opts.parentId as ModuleId | undefined,
      })
    } catch (err) {
      console.error('[astrale] Init failed:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  })
