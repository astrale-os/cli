/**
 * context.ts — persists studio context items split into two buckets:
 *   - user items at  context/user/index.json   (ContextItem[])
 *   - auto items at  context/auto/index.json    (ContextItem[])
 * Auto items are also mirrored to readable .md files under context/auto/ so an
 * external agent can read them from disk. ALL writes go through store.ts.
 */
import type { ContextItem, ContextStore } from '../../shared/types'

import { readJson, writeJson, writeState } from './store'

const USER_PATH = 'context/user/index.json'
const AUTO_PATH = 'context/auto/index.json'

function readUser(root: string): ContextItem[] {
  return readJson<ContextItem[]>(root, USER_PATH, [])
}

function readAuto(root: string): ContextItem[] {
  return readJson<ContextItem[]>(root, AUTO_PATH, [])
}

function writeUser(root: string, items: ContextItem[]): void {
  writeJson(root, USER_PATH, items)
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

export function addUserContext(
  root: string,
  input: { title: string; body: string; source?: string },
): ContextItem {
  const item: ContextItem = {
    id: crypto.randomUUID(),
    bucket: 'user',
    title: input.title,
    body: input.body,
    source: input.source,
    updatedAt: now(),
  }
  const items = readUser(root)
  items.push(item)
  writeUser(root, items)
  return item
}

export function updateContext(
  root: string,
  id: string,
  patch: { title?: string; body?: string },
): ContextItem | null {
  const user = readUser(root)
  const ui = user.findIndex((it) => it.id === id)
  if (ui !== -1) {
    const updated: ContextItem = {
      ...user[ui],
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.body !== undefined ? { body: patch.body } : {}),
      updatedAt: now(),
    }
    user[ui] = updated
    writeUser(root, user)
    return updated
  }
  const auto = readAuto(root)
  const ai = auto.findIndex((it) => it.id === id)
  if (ai !== -1) {
    const updated: ContextItem = {
      ...auto[ai],
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.body !== undefined ? { body: patch.body } : {}),
      updatedAt: now(),
    }
    auto[ai] = updated
    writeAuto(root, auto)
    return updated
  }
  return null
}

export function deleteContext(root: string, id: string): boolean {
  const user = readUser(root)
  const userKept = user.filter((it) => it.id !== id)
  if (userKept.length !== user.length) {
    writeUser(root, userKept)
    return true
  }
  const auto = readAuto(root)
  const autoKept = auto.filter((it) => it.id !== id)
  if (autoKept.length !== auto.length) {
    writeAuto(root, autoKept)
    return true
  }
  return false
}

export function setAutoInclude(root: string, id: string, include: boolean): ContextItem | null {
  const auto = readAuto(root)
  const idx = auto.findIndex((it) => it.id === id)
  if (idx === -1) return null
  const updated: ContextItem = {
    ...auto[idx],
    includeInHandoff: include,
    updatedAt: now(),
  }
  auto[idx] = updated
  writeAuto(root, auto)
  return updated
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
