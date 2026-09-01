/**
 * anatomy.ts — the non-schema structure: overview (identity/adapter/pkg),
 * views, client tree, env fields, and a SHALLOW readdir of integrations/
 * (dir names only — a hint, never a parse).
 *
 * Overview is implemented here; views/client/env are filled by the
 * introspection swarm in anatomy-extras.ts. The composition entry is statically
 * parsed, never executed (its dependency graph may have import side effects).
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import type { DomainAnatomy, DomainOverview, SchemaIR } from '../../shared/types'

import { resolveApplicationEntry } from '../domain'
import { asJsonRecord, asString, parseJson } from '../json'
import { studioSettings } from '../studio-settings'
import { buildClientTree, buildEnvFields, buildViews, findSchemaDefinition } from './anatomy-extras'
import { readConfigPreview } from './config-preview'

export interface AnatomyArgs {
  root: string
  schemaDirName: string
  clientDir?: string
  canonicalViews?: NonNullable<SchemaIR['views']>
}

export function buildAnatomy({
  root,
  schemaDirName,
  clientDir,
  canonicalViews,
}: AnatomyArgs): DomainAnatomy {
  const schema = findSchemaDefinition(root, schemaDirName)
  const authoredClientDir =
    clientDir ?? (existsSync(join(root, 'ui')) ? join(root, 'ui') : undefined)
  return {
    overview: buildOverview(root, schemaDirName, authoredClientDir, schema?.origin),
    views: buildViews(root, schemaDirName, canonicalViews),
    client: buildClientTree(root, clientDir ?? null),
    env: buildEnvFields(root),
    detectedIntegrations: detectIntegrations(root),
  }
}

function buildOverview(
  root: string,
  schemaDirName: string,
  clientDir?: string,
  schemaOrigin?: string,
): DomainOverview {
  const pkg = readPackageJsonSafe(join(root, 'package.json'))
  const astraleDeps: Record<string, string> = {}
  for (const [k, v] of Object.entries({
    ...(pkg?.dependencies ?? {}),
    ...(pkg?.devDependencies ?? {}),
  })) {
    if (k.startsWith('@astrale-os/')) astraleDeps[k] = String(v)
  }

  const config = readConfigPreview(root)

  const application = resolveApplicationEntry(root)
  const applicationSrc = application === null ? '' : readTextSafe(application)
  const origin =
    schemaOrigin ??
    applicationSrc.match(/defineSchema\(\s*['"]([^'"]+)['"]/)?.[1] ??
    readTextSafe(join(root, schemaDirName, 'index.ts')).match(
      /defineSchema\(\s*['"]([^'"]+)['"]/,
    )?.[1] ??
    ''

  return {
    origin,
    applicationFile:
      application === null ? undefined : relative(root, application).replaceAll('\\', '/'),
    adapter: config.adapter,
    prodTarget: config.prodTarget,
    devSecrets: config.devSecrets,
    requires: [],
    packageName: pkg?.name,
    packageVersion: pkg?.version,
    astraleDeps,
    schemaDir: schemaDirName,
    client: clientDir ? relative(root, clientDir).replaceAll('\\', '/') || '.' : undefined,
  }
}

function detectIntegrations(root: string): string[] {
  const dir = join(root, studioSettings().integrationsDir)
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir).filter((e) => {
      try {
        return statSync(join(dir, e)).isDirectory()
      } catch {
        return false
      }
    })
  } catch {
    return []
  }
}

function readTextSafe(f: string): string {
  try {
    return existsSync(f) ? readFileSync(f, 'utf8') : ''
  } catch {
    return ''
  }
}

interface PackageOverview {
  name?: string
  version?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

function decodeDependencyMap(value: unknown): Record<string, string> | undefined {
  const record = asJsonRecord(value)
  if (!record) return undefined
  return Object.fromEntries(
    Object.entries(record).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  )
}

function readPackageJsonSafe(f: string): PackageOverview | null {
  try {
    const record = asJsonRecord(parseJson(readFileSync(f, 'utf8')))
    if (!record) return null
    const name = asString(record.name)
    const version = asString(record.version)
    const dependencies = decodeDependencyMap(record.dependencies)
    const devDependencies = decodeDependencyMap(record.devDependencies)
    return {
      ...(name === undefined ? {} : { name }),
      ...(version === undefined ? {} : { version }),
      ...(dependencies === undefined ? {} : { dependencies }),
      ...(devDependencies === undefined ? {} : { devDependencies }),
    }
  } catch {
    return null
  }
}
