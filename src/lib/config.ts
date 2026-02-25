import type { ApplicationId, AvatarId, ModuleId, SpaceId } from '@astrale-os/kernel-core'
import { mkdir, readFile, writeFile } from 'fs/promises'
import path from 'path'
import { resolveConfig, type ResolvedConfig } from './global-config'

export interface AstraleConfig {
  appId: ApplicationId
  profile: string
  typesContainerId?: ModuleId
  workerBundleId?: ModuleId
  uiBundleId?: ModuleId
  sourceBundleId?: ModuleId
  workerUrl?: string
  uiUrl?: string
  bootstrap?: { avatar: ModuleId; space: ModuleId; global: ModuleId }
  remoteAppdata?: { avatar: ModuleId; space: ModuleId; global: ModuleId }
  endpoints?: { containerId: ModuleId; workerContainerId: ModuleId; backendContainerId: ModuleId }
  spaceId?: SpaceId
  avatarId?: AvatarId
  privateKey?: string
}

export interface FullConfig extends AstraleConfig, ResolvedConfig {}

const CONFIG_DIR = '.astrale'
const CONFIG_FILE = 'config.json'

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

export async function loadConfig(projectDir: string): Promise<AstraleConfig> {
  const configPath = path.join(projectDir, CONFIG_DIR, CONFIG_FILE)
  try {
    const content = await readFile(configPath, 'utf-8')
    const config = JSON.parse(content) as Partial<AstraleConfig>
    if (!config.appId) throw new Error('Missing required field: appId')
    if (!config.profile) throw new Error('Missing required field: profile')
    return config as AstraleConfig
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        `No .astrale/config.json found in ${projectDir}.\nRun 'astrale init' to initialize a new app.`,
      )
    }
    throw err
  }
}

export async function saveConfig(projectDir: string, config: AstraleConfig): Promise<void> {
  const configDir = path.join(projectDir, CONFIG_DIR)
  const configPath = path.join(configDir, CONFIG_FILE)
  await mkdir(configDir, { recursive: true })
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
}

export async function loadFullConfig(
  projectDir: string,
  profileOverride?: string,
): Promise<FullConfig> {
  const projectConfig = await loadConfig(projectDir)
  const resolved = await resolveConfig(profileOverride ?? projectConfig.profile)
  return { ...projectConfig, ...resolved }
}

export function getConfigPath(projectDir: string): string {
  return path.join(projectDir, CONFIG_DIR, CONFIG_FILE)
}

export { resolveConfig, type ResolvedConfig }
