import type { RememberedViewTarget, ViewTargetCandidate } from '../../shared/types'

import { asJsonRecord, asString } from '../json'
import { readJson, writeJson } from '../state/store'

const STATE_FILE = 'views.json'

interface StoredViewState {
  targets?: Record<string, Record<string, RememberedViewTarget>>
}

function decodeRememberedTarget(value: unknown): RememberedViewTarget | undefined {
  const record = asJsonRecord(value)
  const id = asString(record?.id)
  const className = asString(record?.className)
  const classOrigin = asString(record?.classOrigin)
  const label = asString(record?.label)
  return id && className && classOrigin && label ? { id, className, classOrigin, label } : undefined
}

function decodeStoredViewState(value: unknown): StoredViewState | undefined {
  const record = asJsonRecord(value)
  if (!record) return undefined
  const targets: NonNullable<StoredViewState['targets']> = {}
  for (const [instance, bySlugValue] of Object.entries(asJsonRecord(record.targets) ?? {})) {
    const bySlug: Record<string, RememberedViewTarget> = {}
    for (const [slug, targetValue] of Object.entries(asJsonRecord(bySlugValue) ?? {})) {
      const target = decodeRememberedTarget(targetValue)
      if (target) bySlug[slug] = target
    }
    targets[instance] = bySlug
  }
  return { targets }
}

export function rememberTarget(
  root: string,
  instance: string,
  slug: string,
  target: ViewTargetCandidate,
): void {
  const stored = readJson(root, STATE_FILE, decodeStoredViewState, {})
  stored.targets ??= {}
  stored.targets[instance] ??= {}
  stored.targets[instance][slug] = {
    id: target.id,
    className: target.className,
    classOrigin: target.classOrigin,
    label: target.label,
  }
  writeJson(root, STATE_FILE, stored)
}

export function readRememberedTarget(
  root: string,
  instance: string,
  slug: string,
): RememberedViewTarget | null {
  return readJson(root, STATE_FILE, decodeStoredViewState, {}).targets?.[instance]?.[slug] ?? null
}
