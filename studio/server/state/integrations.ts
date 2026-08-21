/**
 * integrations.ts — persists user-declared integrations at integrations.json
 * ({ integrations: Integration[] }). `detectedSubfolders` is a caller-supplied
 * hint (a shallow readdir of integrations/) merged in on read, never persisted.
 * ALL writes go through store.ts.
 */
import type { Integration, IntegrationsState } from '../../shared/types'

import { asJsonRecord, asString } from '../json'
import { readJson, writeJson } from './store'

const PATH = 'integrations.json'

interface IntegrationsFile {
  integrations: Integration[]
}

function decodeIntegration(value: unknown): Integration | undefined {
  const record = asJsonRecord(value)
  const id = asString(record?.id)
  const name = asString(record?.name)
  const kind = asString(record?.kind)
  const status = asString(record?.status)
  if (id === undefined || name === undefined || kind === undefined || status === undefined)
    return undefined
  const notes = asString(record?.notes)
  return { id, name, kind, status, ...(notes === undefined ? {} : { notes }) }
}

function decodeIntegrationsFile(value: unknown): IntegrationsFile | undefined {
  const record = asJsonRecord(value)
  if (!record) return undefined
  return {
    integrations: Array.isArray(record.integrations)
      ? record.integrations.flatMap((item) => {
          const integration = decodeIntegration(item)
          return integration ? [integration] : []
        })
      : [],
  }
}

function read(root: string): Integration[] {
  return readJson(root, PATH, decodeIntegrationsFile, { integrations: [] }).integrations
}

function write(root: string, integrations: Integration[]): void {
  writeJson(root, PATH, { integrations })
}

export function readIntegrations(root: string, detectedSubfolders: string[]): IntegrationsState {
  return { integrations: read(root), detectedSubfolders }
}

export function upsertIntegration(
  root: string,
  input: { id?: string; name: string; kind: string; status: string; notes?: string },
): Integration {
  const integrations = read(root)
  const id = input.id ?? crypto.randomUUID()
  const next: Integration = {
    id,
    name: input.name,
    kind: input.kind,
    status: input.status,
    notes: input.notes,
  }
  const idx = integrations.findIndex((it) => it.id === id)
  if (idx === -1) integrations.push(next)
  else integrations[idx] = next
  write(root, integrations)
  return next
}

export function deleteIntegration(root: string, id: string): boolean {
  const integrations = read(root)
  const kept = integrations.filter((it) => it.id !== id)
  if (kept.length === integrations.length) return false
  write(root, kept)
  return true
}
