import type { RunResult } from '../lib/proc'

import { AstraleError } from '../errors'

export const UI_PACKAGE = '@astrale-os/ui'
export const UI_REPOSITORY = 'astrale-os/ui'
export const UI_LOCK_FILE = 'astrale-ui.lock.json'
export const UI_PRESETS = ['astrale', 'compact', 'expressive'] as const

/** Custom properties every theme defines once for light and once for dark. */
export const THEME_TOKENS = [
  'background',
  'foreground',
  'card',
  'card-foreground',
  'popover',
  'popover-foreground',
  'primary',
  'primary-foreground',
  'secondary',
  'secondary-foreground',
  'muted',
  'muted-foreground',
  'accent',
  'accent-foreground',
  'destructive',
  'destructive-foreground',
  'border',
  'input',
  'ring',
  'chart-1',
  'chart-2',
  'chart-3',
  'chart-4',
  'chart-5',
  'font-body',
  'font-heading',
  'radius',
  'radius-panel',
  'control-height',
  'control-height-sm',
  'control-height-lg',
  'shadow-control',
  'shadow-panel',
  'motion-fast',
  'motion-standard',
] as const

export type UiPreset = (typeof UI_PRESETS)[number]
export type PackageManager = 'pnpm' | 'npm' | 'yarn' | 'bun'

export type UiRunner = (file: string, args: string[], cwd: string) => Promise<RunResult>

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
  content?: string
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

export type UiReleaseIdentity = Pick<UiRelease, 'version' | 'ref' | 'commit'>

export type UiErrorCode =
  | 'UI_PROJECT_UNSUPPORTED'
  | 'UI_CONFIG_MISSING'
  | 'UI_REGISTRY_UNAVAILABLE'
  | 'UI_ITEM_NOT_FOUND'
  | 'UI_ITEM_CONFLICT'
  | 'UI_LOCAL_CHANGES'
  | 'UI_DEPENDENCY_INSTALL_FAILED'
  | 'UI_LOCK_INVALID'
  | 'UI_TOOL_FAILED'
  | 'UI_SEARCH_QUERY_INVALID'
  | 'UI_SEARCH_UNAVAILABLE'
  | 'UI_REQUEST_QUERY_INVALID'
  | 'UI_REQUEST_UNAVAILABLE'

export class UiError extends AstraleError {
  constructor(code: UiErrorCode, message: string, hint?: string, options?: ErrorOptions) {
    super(code, message, hint, options)
  }
}

/** A plain JSON object (not an array, not a class instance). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

export function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value)
}

export const RELEASE_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u
