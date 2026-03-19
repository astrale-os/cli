import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { CONFIG_PATH } from './paths'

export type AstraleConfig = {
  managerPort: number
  falkorPort: number
  uiPort: number
  graphName: string
  issuer: string
}

const DEFAULTS: AstraleConfig = {
  managerPort: 4400,
  falkorPort: 6379,
  uiPort: 4300,
  graphName: 'astrale-manager',
  issuer: 'https://manager.astrale.ai',
}

export async function readConfig(): Promise<AstraleConfig> {
  try {
    const raw = await readFile(CONFIG_PATH, 'utf-8')
    return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {
    return DEFAULTS
  }
}

export async function writeConfig(config: AstraleConfig): Promise<void> {
  await mkdir(dirname(CONFIG_PATH), { recursive: true })
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n')
}

export async function configExists(): Promise<boolean> {
  try {
    await readFile(CONFIG_PATH)
    return true
  } catch {
    return false
  }
}
