/**
 * documents.ts — context DOCUMENTS the user drops in for the AI agent. Files live
 * under `.domain-studio/context/docs/`, named after the document (not its id), so
 * the folder is readable by a human and by the agent that is handed its path.
 * They travel with the domain and are part of the agent handoff context.
 */
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { extname } from 'node:path'

import type { DocMeta } from '../../shared/types'

import { asFiniteNumber, asJsonRecord, asString } from '../json'
import { readJson, removeState, statePath, writeJson, writeStateBuffer } from './store'

const INDEX = 'context/documents/index.json'
const DIR = 'context/docs'
/** Where documents lived before they were named: `context/documents/<uuid>.<ext>`. */
const LEGACY_DIR = 'context/documents'

/** `Pricing decisions.md` → `pricing-decisions` — a file name you can read. */
function slugify(name: string): string {
  const base = name.replace(/\.[^.]+$/, '')
  const slug = base
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return slug || 'document'
}

/** A stored path no other document (and no file on disk) already claims. */
function uniqueStoredPath(root: string, docs: DocMeta[], name: string): string {
  const extension = extname(name).toLowerCase()
  const slug = slugify(name)
  const taken = new Set(docs.map((doc) => doc.stored))
  for (let attempt = 0; ; attempt++) {
    const candidate = `${DIR}/${slug}${attempt === 0 ? '' : `-${attempt + 1}`}${extension}`
    if (!taken.has(candidate) && !existsSync(statePath(root, candidate))) return candidate
  }
}

/**
 * Move documents written under the old uuid-named layout into `context/docs/`.
 * Idempotent and only ever renames inside the studio's own state directory.
 */
export function migrateDocuments(root: string): void {
  const docs = listDocuments(root)
  if (!docs.some((doc) => doc.stored.startsWith(`${LEGACY_DIR}/`))) return
  let moved = false
  for (const doc of docs) {
    if (!doc.stored.startsWith(`${LEGACY_DIR}/`)) continue
    const from = statePath(root, doc.stored)
    if (!existsSync(from)) continue
    const next = uniqueStoredPath(root, docs, doc.name)
    writeStateBuffer(root, next, readFileSync(from))
    removeState(root, doc.stored)
    doc.stored = next
    moved = true
  }
  if (moved) writeJson(root, INDEX, docs)
}

function decodeDocument(value: unknown): DocMeta | undefined {
  const record = asJsonRecord(value)
  const id = asString(record?.id)
  const name = asString(record?.name)
  const type = asString(record?.type)
  const size = asFiniteNumber(record?.size)
  const addedAt = asString(record?.addedAt)
  const stored = asString(record?.stored)
  if (
    !id ||
    name === undefined ||
    type === undefined ||
    size === undefined ||
    size < 0 ||
    !addedAt ||
    !(stored?.startsWith(`${DIR}/`) || stored?.startsWith(`${LEGACY_DIR}/`)) ||
    stored.split('/').includes('..')
  ) {
    return undefined
  }
  const updatedAt = asString(record?.updatedAt)
  return {
    id,
    name,
    type,
    size,
    addedAt,
    stored,
    ...(updatedAt === undefined ? {} : { updatedAt }),
  }
}

function decodeDocuments(value: unknown): DocMeta[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.flatMap((item) => {
    const document = decodeDocument(item)
    return document ? [document] : []
  })
}

export function listDocuments(root: string): DocMeta[] {
  return readJson(root, INDEX, decodeDocuments, [])
}

export function addDocument(root: string, name: string, type: string, data: Uint8Array): DocMeta {
  const docs = listDocuments(root)
  const stored = uniqueStoredPath(root, docs, name || 'untitled')
  writeStateBuffer(root, stored, data)
  const meta: DocMeta = {
    id: randomUUID(),
    name: name || 'untitled',
    type: type || 'application/octet-stream',
    size: data.byteLength,
    addedAt: new Date().toISOString(),
    stored,
  }
  docs.unshift(meta)
  writeJson(root, INDEX, docs)
  return meta
}

/** Overwrite an existing document's content in place (keeps id/name). */
export function updateDocument(root: string, id: string, data: Uint8Array): DocMeta | null {
  const docs = listDocuments(root)
  const doc = docs.find((d) => d.id === id)
  if (!doc) return null
  writeStateBuffer(root, doc.stored, data)
  doc.size = data.byteLength
  doc.updatedAt = new Date().toISOString()
  writeJson(root, INDEX, docs)
  return doc
}

export function deleteDocument(root: string, id: string): boolean {
  const docs = listDocuments(root)
  const doc = docs.find((d) => d.id === id)
  if (!doc) return false
  removeState(root, doc.stored)
  writeJson(
    root,
    INDEX,
    docs.filter((d) => d.id !== id),
  )
  return true
}

export function readDocument(root: string, id: string): { meta: DocMeta; abs: string } | null {
  const doc = listDocuments(root).find((d) => d.id === id)
  if (!doc) return null
  const abs = statePath(root, doc.stored)
  if (!existsSync(abs)) return null
  return { meta: doc, abs }
}
