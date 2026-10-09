import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Node, type SourceFile } from 'ts-morph'

import type { EnvField } from '../../../shared/types'

import { makeProject } from './source'

/** Strip the leading-JSDoc decorations to a single trimmed line of prose. */
function cleanDoc(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const text = raw
    .replace(/^\/\*\*?/, '')
    .replace(/\*\/$/, '')
    .split('\n')
    .map((l) => l.replace(/^\s*\*\s?/, '').trimEnd())
    .join('\n')
    .trim()
    .replace(/\s*\n\s*/g, ' ')
    .trim()
  return text.length ? text : undefined
}

const KNOWN_INFRA_FIELDS = new Set(['WORKER_URL', 'ASSETS', 'SELF', 'VIEW_DEV_URL'])

export function buildEnvFields(root: string): EnvField[] {
  const envFile = join(root, 'env.ts')
  if (!existsSync(envFile)) return []

  let sf: SourceFile
  try {
    sf = makeProject().addSourceFileAtPath(envFile)
  } catch {
    return []
  }

  const iface = sf.getInterface('Env')
  if (!iface) return []

  const fields: EnvField[] = []
  for (const member of iface.getMembers()) {
    // Only named properties; skips index signatures such as `[key: string]: unknown`.
    if (!Node.isPropertySignature(member)) continue

    const name = member.getName()
    if (!name) continue

    const optional = member.hasQuestionToken()
    const doc = cleanDoc(member.getJsDocs()[0]?.getInnerText())
    const secret = !KNOWN_INFRA_FIELDS.has(name)

    const field: EnvField = { name, optional, secret }
    if (doc) field.doc = doc
    fields.push(field)
  }

  return fields
}
