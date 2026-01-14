/**
 * astrale init
 *
 * Creates a new application in the kernel and sets up .astrale/config.json
 */

import type { AvatarId, ModuleId, SpaceId } from "@astrale-os/kernel-core"
import { Command } from "commander"

import { type AstraleConfig, getConfigPath, saveConfig } from "../lib/config"
import { generateAppKeyPair } from "../lib/crypto"
import { createKernelClient } from "../lib/kernel"

export type InitOptions = {
  title: string
  kernelUrl: string
  kernelRpcUrl: string
  avatarId: AvatarId
  token: string
  parentId?: ModuleId
}

export async function runInit(options: InitOptions): Promise<void> {
  console.log(`[astrale] Initializing new application...`)
  console.log(`  Title:      ${options.title}`)
  console.log(`  Kernel WS:  ${options.kernelUrl}`)
  console.log(`  Kernel RPC: ${options.kernelRpcUrl}`)
  console.log(`  Avatar:     ${options.avatarId}`)

  // Generate keypair for app identity
  console.log(`\n[astrale] Generating app keypair...`)
  const keyPair = await generateAppKeyPair()
  console.log(`  ✓ Keypair generated (ECDSA P-256)`)

  console.log(`\n[astrale] Connecting to kernel...`)
  const client = await createKernelClient({
    kernelUrl: options.kernelUrl,
    avatarId: options.avatarId,
    token: options.token,
  })

  try {
    const parentId = options.parentId ?? options.avatarId

    if (!parentId) {
      throw new Error("Parent ID is required. Use --parent-id to specify where to create the app.")
    }

    console.log(`[astrale] Creating application...`)
    const result = await client.createApp(parentId, undefined, keyPair.publicKeyJwk)

    console.log(`  ✓ Application created`)
    console.log(`  App ID: ${result.appId}`)
    console.log(`  Worker URL: ${result.workerUrl}`)
    console.log(`  UI URL: ${result.uiUrl}`)

    const config: AstraleConfig = {
      appId: result.appId,
      typesContainerId: result.typesContainerId,
      workerBundleId: result.workerBundleId,
      uiBundleId: result.uiBundleId,
      sourceBundleId: result.sourceBundleId,
      workerUrl: result.workerUrl,
      uiUrl: result.uiUrl,
      bootstrap: result.bootstrap,
      remoteAppdata: result.remoteAppdata,
      endpoints: result.endpoints,
      kernelUrl: options.kernelUrl,
      kernelRpcUrl: options.kernelRpcUrl,
      datastoreUrl: "http://127.0.0.1:3002/v1/datastore",
      avatarId: options.avatarId,
      token: options.token,
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

export const initCommand = new Command("init")
  .description("Initialize a new Astrale app in the kernel")
  .requiredOption("--title <name>", "Application title")
  .requiredOption("--kernel-url <url>", "Kernel WebSocket URL (e.g., ws://localhost:8081)")
  .requiredOption("--kernel-rpc-url <url>", "Kernel RPC URL (e.g., http://localhost:8083)")
  .requiredOption("--avatar-id <id>", "Avatar ID for authenticated calls")
  .requiredOption("--token <token>", "Authentication token")
  .option("--parent-id <id>", "Parent module ID (defaults to avatar)")
  .action(async (opts) => {
    try {
      await runInit({
        title: opts.title,
        kernelUrl: opts.kernelUrl,
        kernelRpcUrl: opts.kernelRpcUrl,
        avatarId: opts.avatarId as AvatarId,
        token: opts.token,
        parentId: opts.parentId as ModuleId | undefined,
      })
    } catch (err) {
      console.error("[astrale] Init failed:", err instanceof Error ? err.message : err)
      process.exit(1)
    }
  })
