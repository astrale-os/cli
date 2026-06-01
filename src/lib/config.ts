import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'

import { log } from './log'
import { CONFIG_PATH } from './paths'

export const AstraleConfigSchema = z.object({
  // Local identity credentials still need an issuer for first-contact calls
  // before the target kernel records a registration-specific issuer.
  issuer: z.string().url().default('https://identity.astrale.ai'),
})

export type AstraleConfig = z.infer<typeof AstraleConfigSchema>

const DEFAULTS: AstraleConfig = AstraleConfigSchema.parse({})

export async function readConfig(): Promise<AstraleConfig> {
  try {
    const raw = await readFile(CONFIG_PATH, 'utf-8')
    return AstraleConfigSchema.parse(JSON.parse(raw))
  } catch (e) {
    // A present-but-broken config (invalid JSON or failed validation) should
    // surface; a missing file (readFile ENOENT) stays silent — that's the
    // normal first-run case and defaults are expected.
    if (e instanceof z.ZodError || e instanceof SyntaxError) {
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
