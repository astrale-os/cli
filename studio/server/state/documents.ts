/**
 * documents.ts — context DOCUMENTS the user drops in for the AI agent. Files are
 * stored under `.domain-studio/context/documents/` (allow-listed) and tracked in
 * an index. They travel with the domain and are part of the agent handoff context.
 */
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { extname } from 'node:path'

import type { DocMeta } from '../../shared/types'

import { readJson, removeState, statePath, writeJson, writeStateBuffer } from './store'

const INDEX = 'context/documents/index.json'
const storedPath = (id: string, name: string) => `context/documents/${id}${extname(name)}`

export function listDocuments(root: string): DocMeta[] {
  return readJson<DocMeta[]>(root, INDEX, [])
}

export function addDocument(root: string, name: string, type: string, data: Uint8Array): DocMeta {
  const id = randomUUID()
  const stored = storedPath(id, name)
  writeStateBuffer(root, stored, data)
  const meta: DocMeta = {
    id,
    name: name || 'untitled',
    type: type || 'application/octet-stream',
    size: data.byteLength,
    addedAt: new Date().toISOString(),
    stored,
  }
  const docs = listDocuments(root)
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
