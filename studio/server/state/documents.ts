/**
 * documents.ts — context DOCUMENTS the user drops in for the AI agent. Files live
 * under `.domain-studio/context/docs/`, named after the document (not its id), so
 * the folder is readable by a human and by the agent that is handed its path.
 * They travel with the domain and are part of the agent handoff context.
 *
 * Their index is read whole or not at all (state-file.ts): one entry it cannot decode, and no
 * document is added, updated or deleted until it is fixed — none is dropped from it unsaid.
 */
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { extname } from 'node:path'

import type { DocMeta } from '../../shared/contracts/workspace'

import { asJsonRecord, refused, type Decoded } from '../json'
import { changeStateFile, stateOf, UnreadableState, type StateFile } from './state-file'
import { removeState, statePath, writeStateBuffer } from './store'

const INDEX = 'context/documents/index.json'
const DIR = 'context/docs'

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

/** One document of the index, or why it does not decode. */
function documentOf(value: unknown, at: string): Decoded<DocMeta> {
  const record = asJsonRecord(value)
  if (!record) return refused(`${at} is not a record`)
  const { id, name, type, size, addedAt, stored, updatedAt } = record
  if (typeof id !== 'string' || id.length === 0) return refused(`${at} has no id`)
  const which = `${at} (${id})`
  if (typeof name !== 'string') return refused(`${which} has no name`)
  if (typeof type !== 'string') return refused(`${which} has no type`)
  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0)
    return refused(`${which} has no size in bytes`)
  if (typeof addedAt !== 'string' || addedAt.length === 0)
    return refused(`${which} does not say when it was added`)
  if (updatedAt !== undefined && typeof updatedAt !== 'string')
    return refused(`${which} says when it was updated in no text`)
  if (
    typeof stored !== 'string' ||
    !stored.startsWith(`${DIR}/`) ||
    stored.split('/').includes('..')
  )
    return refused(`${which} is not stored under ${DIR}/`)
  return {
    value: {
      id,
      name,
      type,
      size,
      addedAt,
      stored,
      ...(updatedAt === undefined ? {} : { updatedAt }),
    },
  }
}

function documentsOf(value: unknown): Decoded<DocMeta[]> {
  if (!Array.isArray(value)) return refused('it lists no documents')
  const docs: DocMeta[] = []
  const ids = new Set<string>()
  for (const [index, candidate] of value.entries()) {
    const doc = documentOf(candidate, `document ${index + 1}`)
    if ('problem' in doc) return doc
    if (ids.has(doc.value.id))
      return refused(`document ${index + 1} (${doc.value.id}) repeats the id of another`)
    ids.add(doc.value.id)
    docs.push(doc.value)
  }
  return { value: docs }
}

const DOCUMENTS: StateFile<DocMeta[]> = {
  name: INDEX,
  decode: documentsOf,
  shape: {
    list: {
      record: {
        id: null,
        name: null,
        type: null,
        size: null,
        addedAt: null,
        stored: null,
        updatedAt: null,
      },
    },
    by: 'id',
  },
  empty: () => [],
}

/** The documents, newest first; `UnreadableState` when the index is not read whole. */
export function listDocuments(root: string): DocMeta[] {
  return stateOf(root, DOCUMENTS)
}

/**
 * The documents an agent turn is handed: none when the index is not read whole, with why,
 * so a turn still runs and is told — no write goes over that index meanwhile.
 */
export function briefedDocuments(root: string): {
  readonly documents: DocMeta[]
  readonly unreadable?: string
} {
  try {
    return { documents: listDocuments(root) }
  } catch (error) {
    if (error instanceof UnreadableState) return { documents: [], unreadable: error.message }
    throw error
  }
}

/**
 * Adds a document; its bytes are written only once the index is read whole, so a document is
 * never stored beside an index that cannot name it.
 */
export function addDocument(root: string, name: string, type: string, data: Uint8Array): DocMeta {
  const docName = name || 'untitled'
  const docs = changeStateFile(root, DOCUMENTS, (current) => {
    const stored = uniqueStoredPath(root, current, docName)
    writeStateBuffer(root, stored, data)
    const meta: DocMeta = {
      id: randomUUID(),
      name: docName,
      type: type || 'application/octet-stream',
      size: data.byteLength,
      addedAt: new Date().toISOString(),
      stored,
    }
    return [meta, ...current]
  })
  return docs[0]!
}

/** Overwrite an existing document's content in place (keeps id/name). */
export function updateDocument(root: string, id: string, data: Uint8Array): DocMeta | null {
  const docs = changeStateFile(root, DOCUMENTS, (current) => {
    const doc = current.find((d) => d.id === id)
    if (!doc) return undefined
    writeStateBuffer(root, doc.stored, data)
    const updated = { ...doc, size: data.byteLength, updatedAt: new Date().toISOString() }
    return current.map((d) => (d.id === id ? updated : d))
  })
  return docs.find((d) => d.id === id) ?? null
}

export function deleteDocument(root: string, id: string): boolean {
  let deleted = false
  changeStateFile(root, DOCUMENTS, (docs) => {
    const doc = docs.find((d) => d.id === id)
    if (!doc) return undefined
    removeState(root, doc.stored)
    deleted = true
    return docs.filter((d) => d.id !== id)
  })
  return deleted
}

export function readDocument(root: string, id: string): { meta: DocMeta; abs: string } | null {
  const doc = listDocuments(root).find((d) => d.id === id)
  if (!doc) return null
  const abs = statePath(root, doc.stored)
  if (!existsSync(abs)) return null
  return { meta: doc, abs }
}
