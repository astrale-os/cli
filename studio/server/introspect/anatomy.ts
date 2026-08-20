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

import type { DomainAnatomy, DomainOverview } from '../../shared/types'

import { readSettings } from '../state/settings'
import { buildClientTree, buildEnvFields, buildViews, findSchemaDefinition } from './anatomy-extras'

export interface AnatomyArgs {
  root: string
  schemaDirName: string
  clientDir?: string
}

export function buildAnatomy({ root, schemaDirName, clientDir }: AnatomyArgs): DomainAnatomy {
  const schema = findSchemaDefinition(root, schemaDirName)
  const authoredClientDir =
    clientDir ?? (existsSync(join(root, 'ui')) ? join(root, 'ui') : undefined)
  return {
    overview: buildOverview(root, schemaDirName, authoredClientDir, schema?.origin),
    views: buildViews(root, schemaDirName),
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
  const pkg = readJsonSafe(join(root, 'package.json'))
  const astraleDeps: Record<string, string> = {}
  for (const [k, v] of Object.entries({
    ...(pkg?.dependencies ?? {}),
    ...(pkg?.devDependencies ?? {}),
  })) {
    if (k.startsWith('@astrale-os/')) astraleDeps[k] = String(v)
  }

  const config = readTextSafe(join(root, 'astrale.config.ts'))
  let adapter: DomainOverview['adapter'] = 'unknown'
  if (/\bastrale\s*\(/.test(config)) adapter = 'astrale'
  else if (/\bcloudflare\s*\(/.test(config)) adapter = 'cloudflare'

  const instance = config.match(/instance\s*:\s*['"]([^'"]+)['"]/)?.[1]
  const route = config.match(/route\s*:\s*['"]([^'"]+)['"]/)?.[1]
  const devSecrets =
    config.match(/dev\s*:\s*\{[^}]*secrets\s*:\s*['"]([^'"]+)['"]/)?.[1] ??
    config.match(/secrets\s*:\s*['"]([^'"]+)['"]/)?.[1]

  const compositionFile = existsSync(join(root, 'implementation.ts'))
    ? 'implementation.ts'
    : existsSync(join(root, 'domain.ts'))
      ? 'domain.ts'
      : undefined
  const domainSrc = compositionFile ? readTextSafe(join(root, compositionFile)) : ''
  const origin =
    schemaOrigin ??
    domainSrc.match(/defineSchema\(\s*['"]([^'"]+)['"]/)?.[1] ??
    readTextSafe(join(root, schemaDirName, 'index.ts')).match(
      /defineSchema\(\s*['"]([^'"]+)['"]/,
    )?.[1] ??
    ''

  return {
    origin,
    compositionFile,
    adapter,
    prodTarget: instance ? `instance: ${instance}` : route ? `route: ${route}` : undefined,
    devSecrets,
    postInstall: undefined,
    requires: [],
    packageName: pkg?.name,
    packageVersion: pkg?.version,
    astraleDeps,
    schemaDir: schemaDirName,
    client: clientDir ? relative(root, clientDir).replaceAll('\\', '/') || '.' : undefined,
  }
}

function detectIntegrations(root: string): string[] {
  const dir = join(root, readSettings(root).integrationsDir)
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

function readJsonSafe(f: string): any {
  try {
    return JSON.parse(readFileSync(f, 'utf8'))
  } catch {
    return null
  }
}
