import type { AvatarId, ModuleId, SpaceId } from '@astrale-os/kernel-core'
import chalk from 'chalk'
import { Command } from 'commander'
import { existsSync } from 'fs'
import { createInterface } from 'readline'
import { type AstraleConfig, getConfigPath, saveConfig } from '../lib/config'
import { generateAppKeyPair } from '../lib/crypto'
import { resolveConfig } from '../lib/global-config'
import { KernelClient } from '../lib/kernel'

async function promptConfirm(message: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(message, (answer) => {
      rl.close()
      const normalized = answer.trim().toLowerCase()
      resolve(normalized === '' || normalized === 'y' || normalized === 'yes')
    })
  })
}

export type InitOptions = {
  title?: string
  profile?: string
  parentId?: ModuleId
}

function resolveActiveIdentity(
  activeSpaceId: SpaceId | undefined,
  activeAvatarId: AvatarId | undefined,
): { avatarId: AvatarId; spaceId: SpaceId } {
  if (!activeSpaceId) {
    throw new Error('No space selected. Run: astrale space create <name>')
  }
  if (!activeAvatarId) {
    throw new Error('No avatar configured for active space. Run: astrale space create <name>')
  }
  return { avatarId: activeAvatarId, spaceId: activeSpaceId }
}

export async function runInit(options: InitOptions): Promise<void> {
  const projectDir = process.cwd()
  const configPath = getConfigPath(projectDir)
  if (existsSync(configPath)) {
    console.log(chalk.yellow(`\n⚠ Existing config found at ${configPath}`))
    console.log(chalk.dim(`  This will create a new app and replace the existing config.\n`))
    const confirmed = await promptConfirm(chalk.white(`Continue? [Y/n] `))
    if (!confirmed) {
      console.log(chalk.dim(`\nInit cancelled.\n`))
      return
    }
    console.log('')
  }
  console.log(`[astrale] Initializing new application...`)
  if (options.title) console.log(`  Title: ${options.title}`)
  const resolved = await resolveConfig(options.profile)
  console.log(`  Profile: ${resolved.profile}`)
  console.log(`  Kernel WS: ${resolved.kernelWsUrl}`)
  console.log(`  Kernel RPC: ${resolved.kernelRpcUrl}`)
  console.log(`\n[astrale] Generating app keypair...`)
  const keyPair = await generateAppKeyPair()
  console.log(`  ✓ Keypair generated (ECDSA P-256)`)
  console.log(`\n[astrale] Connecting to kernel...`)
  const client = new KernelClient({
    kernelWsUrl: resolved.kernelWsUrl,
    accessToken: resolved.accessToken,
  })
  await client.connect()
  try {
    const { avatarId, spaceId } = resolveActiveIdentity(
      resolved.activeSpaceId,
      resolved.activeAvatarId,
    )
    console.log(`  Space: ${spaceId}`)
    console.log(`  Avatar: ${avatarId}`)
    client.setAvatarId(avatarId)
    const parentId = options.parentId ?? avatarId
    console.log(`[astrale] Creating application...`)
    const result = await client.createApp(parentId, undefined, keyPair.publicKeyJwk)
    console.log(`  ✓ Application created`)
    console.log(`  App ID: ${result.appId}`)
    console.log(`  Worker URL: ${result.workerUrl}`)
    console.log(`  UI URL: ${result.uiUrl}`)
    const config: AstraleConfig = {
      appId: result.appId,
      profile: resolved.profile,
      spaceId,
      avatarId,
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
    await saveConfig(projectDir, config)
    console.log(`\n✓ Config saved to ${configPath}`)
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
