import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'

import { CONFIG_PATH } from '../state/index'
import { AdminTargetConfigSchema, DEFAULT_ADMIN_TARGET_CONFIG } from './admin-target'
import { log } from './log'

/** A retention bound, or undefined when absent or nonsensical. A bad value must
 *  fall back to the default rather than take the whole config down with it —
 *  and must never read as "no limit". */
const bound = z.number().positive().finite().optional().catch(undefined)

/**
 * The built-in Admin target before Astrale ran one production environment (2026-10-10). A config
 * that still saves exactly this target reads as saving none, so today's built-in target applies;
 * any other saved target is kept.
 */
const RETIRED_BUILT_IN_ADMIN = {
  url: 'https://admin.eu.beta.astrale.ai/api',
  domainIssuer: 'https://admin.beta.astrale.ai',
} as const

function withoutRetiredBuiltInAdmin(config: unknown): unknown {
  if (typeof config !== 'object' || config === null) return config
  const { admin, ...rest } = config as { admin?: { url?: unknown; domainIssuer?: unknown } }
  return admin?.url === RETIRED_BUILT_IN_ADMIN.url &&
    admin.domainIssuer === RETIRED_BUILT_IN_ADMIN.domainIssuer
    ? rest
    : config
}

export const AstraleConfigSchema = z.preprocess(
  withoutRetiredBuiltInAdmin,
  z.object({
    issuer: z.string().url().default('https://unregistered.invalid'),
    admin: AdminTargetConfigSchema.default(DEFAULT_ADMIN_TARGET_CONFIG),
    // The retention bounds live in the schema, not just in the readers that
    // consume them: zod strips unknown keys, so a config the CLI rewrites (see
    // setup/steps/admin.ts) would silently drop anything declared elsewhere.
    telemetry: z
      .object({
        enabled: z.boolean().default(true),
        analyzerEnabled: z.boolean().default(false),
        maxAgeDays: bound,
        maxBytes: bound,
      })
      .default({ enabled: true, analyzerEnabled: false }),
    browser: z.object({ maxCacheBytes: bound, maxProfileAgeDays: bound }).default({}),
  }),
)

export type AstraleConfig = z.infer<typeof AstraleConfigSchema>

export const DEFAULT_CONFIG: AstraleConfig = AstraleConfigSchema.parse({})

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
    return DEFAULT_CONFIG
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
