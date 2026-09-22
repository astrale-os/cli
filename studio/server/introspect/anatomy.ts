/**
 * anatomy.ts — the non-schema structure: overview (identity/adapter/pkg),
 * views, client tree, env fields, and a SHALLOW readdir of integrations/
 * (dir names only — a hint, never a parse).
 *
 * Overview is implemented here; views/client/env come from the extractors
 * under anatomy/ (re-exported by anatomy-extras.ts). The composition entry is
 * statically parsed, never executed (its dependency graph may have import side
 * effects).
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { DomainAnatomy, DomainOverview, SchemaIR } from '../../shared/types'

import { resolveApplicationEntry } from '../domain'
import { asJsonRecord, asString, parseJson } from '../json'
import { studioSettings } from '../studio-settings'
import { buildClientTree, buildEnvFields, buildViews, findSchemaDefinition } from './anatomy-extras'
import { schemaProject } from './anatomy/schema-definition'
import { listEntries, readTextSafe, relativePosix } from './anatomy/source'
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
  // Parse the authored schema modules once for both the origin and View lookups.
  const schemaSources = schemaProject(root, schemaDirName)
  const schema = findSchemaDefinition(root, schemaDirName, schemaSources)
  const authoredClientDir =
    clientDir ?? (existsSync(join(root, 'ui')) ? join(root, 'ui') : undefined)
  return {
    overview: buildOverview(root, schemaDirName, authoredClientDir, schema?.origin),
    views: buildViews(root, schemaDirName, canonicalViews, schemaSources),
    client: buildClientTree(root, clientDir ?? null),
    env: buildEnvFields(root),
    detectedIntegrations: detectIntegrations(root),
  }
}

/** Textual fallback for the Schema origin when no `defineSchema` call resolves statically. */
const DEFINE_SCHEMA_ORIGIN = /defineSchema\(\s*['"]([^'"]+)['"]/

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
    applicationSrc.match(DEFINE_SCHEMA_ORIGIN)?.[1] ??
    readTextSafe(join(root, schemaDirName, 'index.ts')).match(DEFINE_SCHEMA_ORIGIN)?.[1] ??
    ''

  return {
    origin,
    applicationFile: application === null ? undefined : relativePosix(root, application),
    adapter: config.adapter,
    prodTarget: config.prodTarget,
    devSecrets: config.devSecrets,
    requires: [],
    packageName: pkg?.name,
    packageVersion: pkg?.version,
    astraleDeps,
    schemaDir: schemaDirName,
    client: clientDir ? relativePosix(root, clientDir) || '.' : undefined,
  }
}

/** Integration directory names, in readdir order. */
function detectIntegrations(root: string): string[] {
  return listEntries(join(root, studioSettings().integrationsDir), (stat) => stat.isDirectory())
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
