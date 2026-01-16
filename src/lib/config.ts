/**
 * Astrale Project Configuration
 *
 * Handles reading/writing .astrale/config.json
 */

import {
  type ApplicationId,
  type AvatarId,
  type ModuleId,
  type SpaceId,
} from '@astrale-os/kernel-core'
import { mkdir, readFile, writeFile } from 'fs/promises'
import path from 'path'

export interface AstraleConfig {
  /** Application ID from kernel */
  appId: ApplicationId
  /** Types container module ID */
  typesContainerId?: ModuleId
  /** Worker bundle module ID (for uploading worker code when using source bundles) */
  workerBundleId?: ModuleId
  /** UI bundle module ID (for uploading iframe/html when using source bundles) */
  uiBundleId?: ModuleId
  /** Source bundle module ID (optional, used by some toolchains) */
  sourceBundleId?: ModuleId
  /** Worker URL (for development mode) */
  workerUrl?: string
  /** UI URL (for development mode) */
  uiUrl?: string
  /** Bootstrap module IDs */
  bootstrap?: {
    avatar: ModuleId
    space: ModuleId
    global: ModuleId
  }
  /** Remote appdata module IDs */
  remoteAppdata?: {
    avatar: ModuleId
    space: ModuleId
    global: ModuleId
  }
  /** Endpoint container module IDs */
  endpoints?: {
    containerId: ModuleId
    workerContainerId: ModuleId
    backendContainerId: ModuleId
  }
  /** Kernel WebSocket URL */
  kernelUrl: string
  /** Kernel RPC URL (HTTP endpoint for backend requests) */
  kernelRpcUrl: string
  /** Datastore Gateway URL */
  datastoreUrl: string
  /** Avatar ID for authenticated calls */
  avatarId: AvatarId
  /** Space ID for the application context */
  spaceId?: SpaceId
  /** Authentication token */
  token: string
  /** App private key (PEM format) for signing identity tokens */
  privateKey?: string
}

const CONFIG_DIR = '.astrale'
const CONFIG_FILE = 'config.json'

/**
 * Find the project root by looking for .astrale/config.json
 */
export async function findProjectRoot(startDir: string): Promise<string | null> {
  let dir = startDir
  const root = path.parse(dir).root

  while (dir !== root) {
    const configPath = path.join(dir, CONFIG_DIR, CONFIG_FILE)
    try {
      await readFile(configPath, 'utf-8')
      return dir
    } catch {
      dir = path.dirname(dir)
    }
  }
  return null
}

/**
 * Load config from .astrale/config.json
 */
export async function loadConfig(projectDir: string): Promise<AstraleConfig> {
  const configPath = path.join(projectDir, CONFIG_DIR, CONFIG_FILE)

  try {
    const content = await readFile(configPath, 'utf-8')
    const config = JSON.parse(content) as Partial<AstraleConfig>

    if (!config.appId) {
      throw new Error('Missing required field: appId')
    }
    if (!config.kernelUrl) {
      throw new Error('Missing required field: kernelUrl')
    }

    return config as AstraleConfig
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        `No .astrale/config.json found in ${projectDir}.\n` +
          `Run 'astrale app create' to initialize a new app, or create the config manually.`,
      )
    }
    throw err
  }
}

/**
 * Save config to .astrale/config.json
 */
export async function saveConfig(projectDir: string, config: AstraleConfig): Promise<void> {
  const configDir = path.join(projectDir, CONFIG_DIR)
  const configPath = path.join(configDir, CONFIG_FILE)

  await mkdir(configDir, { recursive: true })
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
}

/**
 * Load config with CLI overrides
 */
export async function loadConfigWithOverrides(
  projectDir: string,
  overrides: Partial<AstraleConfig>,
): Promise<AstraleConfig> {
  const config = await loadConfig(projectDir)

  return {
    ...config,
    ...Object.fromEntries(Object.entries(overrides).filter(([_, v]) => v !== undefined)),
  }
}

/**
 * Get config path for display
 */
export function getConfigPath(projectDir: string): string {
  return path.join(projectDir, CONFIG_DIR, CONFIG_FILE)
}
