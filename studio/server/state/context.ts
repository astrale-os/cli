/**
 * context.ts — persists studio context items split into two buckets:
 *   - user items at  context/user/index.json   (ContextItem[])
 *   - auto items at  context/auto/index.json    (ContextItem[])
 * Auto items are also mirrored to readable .md files under context/auto/ so an
 * external agent can read them from disk. ALL writes go through store.ts.
 */
import type { ContextItem, ContextStore } from '../../shared/types'

import { asBoolean, asJsonRecord, asString } from '../json'
import { readJson, writeJson, writeState } from './store'

const USER_PATH = 'context/user/index.json'
const AUTO_PATH = 'context/auto/index.json'

function decodeContextItem(value: unknown): ContextItem | undefined {
  const record = asJsonRecord(value)
  const id = asString(record?.id)
  const bucket = record?.bucket === 'user' || record?.bucket === 'auto' ? record.bucket : undefined
  const title = asString(record?.title)
  const body = asString(record?.body)
  const updatedAt = asString(record?.updatedAt)
  if (!id || !bucket || title === undefined || body === undefined || !updatedAt) return undefined
  const source = asString(record?.source)
  const includeInHandoff = asBoolean(record?.includeInHandoff)
  const freshness = asString(record?.freshness)
  return {
    id,
    bucket,
    title,
    body,
    updatedAt,
    ...(source === undefined ? {} : { source }),
    ...(includeInHandoff === undefined ? {} : { includeInHandoff }),
    ...(freshness === undefined ? {} : { freshness }),
  }
}

function decodeContextItems(value: unknown): ContextItem[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.flatMap((item) => {
    const decoded = decodeContextItem(item)
    return decoded ? [decoded] : []
  })
}

function readUser(root: string): ContextItem[] {
  return readJson(root, USER_PATH, decodeContextItems, [])
}

function readAuto(root: string): ContextItem[] {
  return readJson(root, AUTO_PATH, decodeContextItems, [])
}

function writeAuto(root: string, items: ContextItem[]): void {
  writeJson(root, AUTO_PATH, items)
}

function now(): string {
  return new Date().toISOString()
}

export function readContext(root: string): ContextStore {
  return { user: readUser(root), auto: readAuto(root) }
}

interface AutoSpec {
  title: string
  body: string | undefined
  file: string
}

export function materializeAuto(
  root: string,
  digests: { changes?: string; schemaChange?: string; comments?: string },
): void {
  const specs: AutoSpec[] = [
    { title: 'Current changes', body: digests.changes, file: 'changes.md' },
    { title: 'Schema changes', body: digests.schemaChange, file: 'schema-change.md' },
    { title: 'Open questions digest', body: digests.comments, file: 'comments-digest.md' },
  ]

  const auto = readAuto(root)
  const ts = now()

  for (const spec of specs) {
    if (spec.body === undefined) continue
    const existing = auto.find((it) => it.title === spec.title)
    if (existing) {
      existing.body = spec.body
      existing.bucket = 'auto'
      existing.source = 'auto-computed'
      existing.freshness = ts
      existing.updatedAt = ts
      // preserve prior include choice
      if (existing.includeInHandoff === undefined) existing.includeInHandoff = false
    } else {
      auto.push({
        id: crypto.randomUUID(),
        bucket: 'auto',
        title: spec.title,
        body: spec.body,
        source: 'auto-computed',
        updatedAt: ts,
        freshness: ts,
        includeInHandoff: false,
      })
    }
    writeState(root, `context/auto/${spec.file}`, spec.body)
  }

  writeAuto(root, auto)
}
