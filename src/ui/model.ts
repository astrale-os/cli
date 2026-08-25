import { AstraleError } from '../errors'

export const UI_PACKAGE = '@astrale-os/ui'
export const UI_REPOSITORY = 'astrale-os/ui'
export const UI_LOCK_FILE = 'astrale-ui.lock.json'
export const UI_PRESETS = ['astrale', 'compact', 'expressive'] as const

export type UiPreset = (typeof UI_PRESETS)[number]
export type PackageManager = 'pnpm' | 'npm' | 'yarn' | 'bun'

export type UiCompatibility = {
  version: 1
  shadcn: string
  base: 'base'
  style: 'nova'
  baseUi: string
  react: string
  tailwind: string
  presets: UiPreset[]
}

export type UiRegistryFile = {
  path: string
  type: string
  target?: string
}

export type UiRegistryItem = {
  name: string
  type: string
  title?: string
  description?: string
  dependencies?: string[]
  files: UiRegistryFile[]
  meta: { canonicalAddress: string; ownership?: string }
}

export type UiRegistry = { name: string; homepage?: string; items: UiRegistryItem[] }

export type UiLockItem = {
  address: string
  sourceDigest: string
  files: Record<string, string>
}

export type UiLock = {
  $schema: string
  version: 1
  package: { name: typeof UI_PACKAGE; version: string }
  registry: { repository: typeof UI_REPOSITORY; ref: string; commit: string }
  tooling: { shadcn: string; base: 'base'; style: 'nova'; baseUi: string }
  preset: UiPreset
  items: Record<string, UiLockItem>
}

export type UiRelease = {
  version: string
  ref: string
  commit: string
  compatibility: UiCompatibility
  registry: UiRegistry
}

export class UiError extends AstraleError {
  constructor(
    code:
      | 'UI_PROJECT_UNSUPPORTED'
      | 'UI_CONFIG_MISSING'
      | 'UI_REGISTRY_UNAVAILABLE'
      | 'UI_ITEM_NOT_FOUND'
      | 'UI_ITEM_CONFLICT'
      | 'UI_LOCAL_CHANGES'
      | 'UI_DEPENDENCY_INSTALL_FAILED'
      | 'UI_LOCK_INVALID'
      | 'UI_TOOL_FAILED',
    message: string,
    hint?: string,
    options?: ErrorOptions,
  ) {
    super(code, message, hint, options)
  }
}
