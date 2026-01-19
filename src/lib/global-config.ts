import type { AvatarId } from '@astrale-os/kernel-core'
import { mkdir, readFile, writeFile } from 'fs/promises'
import os from 'os'
import path from 'path'

export interface ProfileConfig {
  kernelWsUrl: string
  kernelRpcUrl: string
  datastoreUrl: string
}

export interface GlobalConfig {
  activeProfile: string
  profiles: Record<string, ProfileConfig>
}

export interface ProfileAuth {
  avatarId: AvatarId
  token: string
}

export type AuthConfig = Record<string, ProfileAuth>

const DEFAULT_PROFILES: Record<string, ProfileConfig> = {
  local: {
    kernelWsUrl: 'ws://localhost:8081',
    kernelRpcUrl: 'http://localhost:8083',
    datastoreUrl: 'http://127.0.0.1:3002/v1/datastore',
  },
  staging: {
    kernelWsUrl: 'wss://kernel.staging.astrale.ai/ws',
    kernelRpcUrl: 'https://kernel.staging.astrale.ai/rpc',
    datastoreUrl: 'https://datastore.staging.astrale.ai/v1/datastore',
  },
  prod: {
    kernelWsUrl: 'wss://kernel.astrale.ai/ws',
    kernelRpcUrl: 'https://kernel.astrale.ai/rpc',
    datastoreUrl: 'https://datastore.astrale.ai/v1/datastore',
  },
}

const DEFAULT_CONFIG: GlobalConfig = {
  activeProfile: 'local',
  profiles: DEFAULT_PROFILES,
}

export function getConfigDir(): string {
  const xdgConfig = process.env.XDG_CONFIG_HOME
  if (xdgConfig) return path.join(xdgConfig, 'astrale')
  if (process.platform === 'win32') return path.join(os.homedir(), 'AppData', 'Roaming', 'astrale')
  return path.join(os.homedir(), '.config', 'astrale')
}

function getConfigPath(): string {
  return path.join(getConfigDir(), 'config.json')
}

function getAuthPath(): string {
  return path.join(getConfigDir(), 'auth.json')
}

export async function loadGlobalConfig(): Promise<GlobalConfig> {
  const configPath = getConfigPath()
  try {
    const content = await readFile(configPath, 'utf-8')
    const config = JSON.parse(content) as GlobalConfig
    return { ...DEFAULT_CONFIG, ...config, profiles: { ...DEFAULT_PROFILES, ...config.profiles } }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      await saveGlobalConfig(DEFAULT_CONFIG)
      return DEFAULT_CONFIG
    }
    throw err
  }
}

export async function saveGlobalConfig(config: GlobalConfig): Promise<void> {
  const configDir = getConfigDir()
  const configPath = getConfigPath()
  await mkdir(configDir, { recursive: true })
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
}

export async function loadAuth(): Promise<AuthConfig> {
  const authPath = getAuthPath()
  try {
    const content = await readFile(authPath, 'utf-8')
    return JSON.parse(content) as AuthConfig
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return {}
    }
    throw err
  }
}

export async function saveAuth(auth: AuthConfig): Promise<void> {
  const configDir = getConfigDir()
  const authPath = getAuthPath()
  await mkdir(configDir, { recursive: true })
  await writeFile(authPath, JSON.stringify(auth, null, 2) + '\n', { mode: 0o600 })
}

export async function getActiveProfile(): Promise<string> {
  const config = await loadGlobalConfig()
  return config.activeProfile
}

export async function setActiveProfile(profileName: string): Promise<void> {
  const config = await loadGlobalConfig()
  if (!config.profiles[profileName]) {
    throw new Error(
      `Profile "${profileName}" does not exist. Available: ${Object.keys(config.profiles).join(', ')}`,
    )
  }
  config.activeProfile = profileName
  await saveGlobalConfig(config)
}

export async function getProfileConfig(
  profileName?: string,
): Promise<ProfileConfig & { name: string }> {
  const config = await loadGlobalConfig()
  const name = profileName ?? config.activeProfile
  const profile = config.profiles[name]
  if (!profile) {
    throw new Error(
      `Profile "${name}" does not exist. Available: ${Object.keys(config.profiles).join(', ')}`,
    )
  }
  return { ...profile, name }
}

export async function getProfileAuth(profileName?: string): Promise<ProfileAuth | null> {
  const config = await loadGlobalConfig()
  const name = profileName ?? config.activeProfile
  const auth = await loadAuth()
  return auth[name] ?? null
}

export async function setProfileAuth(profileName: string, auth: ProfileAuth): Promise<void> {
  const authConfig = await loadAuth()
  authConfig[profileName] = auth
  await saveAuth(authConfig)
}

export async function clearProfileAuth(profileName: string): Promise<void> {
  const authConfig = await loadAuth()
  delete authConfig[profileName]
  await saveAuth(authConfig)
}

export async function listProfiles(): Promise<
  Array<{ name: string; config: ProfileConfig; isActive: boolean; isAuthenticated: boolean }>
> {
  const globalConfig = await loadGlobalConfig()
  const auth = await loadAuth()
  return Object.entries(globalConfig.profiles).map(([name, config]) => ({
    name,
    config,
    isActive: name === globalConfig.activeProfile,
    isAuthenticated: !!auth[name]?.token,
  }))
}

export interface ResolvedConfig {
  profile: string
  kernelWsUrl: string
  kernelRpcUrl: string
  datastoreUrl: string
  avatarId: AvatarId
  token: string
}

export async function resolveConfig(profileOverride?: string): Promise<ResolvedConfig> {
  const profile = await getProfileConfig(profileOverride)
  const auth = await getProfileAuth(profile.name)
  if (!auth) {
    throw new Error(`Not authenticated for profile "${profile.name}". Run: astrale auth login`)
  }
  return {
    profile: profile.name,
    kernelWsUrl: profile.kernelWsUrl,
    kernelRpcUrl: profile.kernelRpcUrl,
    datastoreUrl: profile.datastoreUrl,
    avatarId: auth.avatarId,
    token: auth.token,
  }
}
