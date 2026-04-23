import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'

import { log } from './log'
import { CONFIG_PATH } from './paths'

export const AstraleConfigSchema = z.object({
  managerPort: z.number().int().positive().default(4400),
  falkorPort: z.number().int().positive().default(6379),
  // FalkorDB hostname reachable by the manager process. On host-mode this
  // is `localhost`; inside the `manager` docker-compose service the
  // manager entrypoint overrides to the compose network alias `falkordb`
  // via `ASTRALE_FALKOR_HOST`.
  falkorHost: z.string().default('localhost'),
  uiPort: z.number().int().positive().default(4300),
  graphName: z.string().default('astrale-manager'),
  // The manager kernel signs tokens with its own base URL as the `iss`
  // claim. The CLI must sign matching tokens or the JWKS lookup fails.
  // Default assumes the stock localhost manager — override via config.json
  // if the manager runs elsewhere.
  issuer: z.string().url().default('http://localhost:4400/mngt'),
})

export type AstraleConfig = z.infer<typeof AstraleConfigSchema>

const DEFAULTS: AstraleConfig = AstraleConfigSchema.parse({})

export async function readConfig(): Promise<AstraleConfig> {
  try {
    const raw = await readFile(CONFIG_PATH, 'utf-8')
    return AstraleConfigSchema.parse(JSON.parse(raw))
  } catch (e) {
    if (e instanceof z.ZodError) {
      log.warn(`Invalid config at ${CONFIG_PATH} — using defaults`)
    }
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
