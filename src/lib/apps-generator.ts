/**
 * Apps Generator
 *
 * Generates typed API wrappers for declared app dependencies.
 * Creates .astrale/apps/ directory with TypeScript files for each dependency.
 */

import { execSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { AppDiscoverResult, SerializedEndpointWithSchema } from '@astrale-os/kernel-api/namespaces'

import type { KernelClient } from './kernel'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type AppDeclarations = Record<string, string>

/** Maps property access path to versioned endpoint name */
export type EndpointMap = Record<string, string>

/** Maps localName to its endpoint map */
export type EndpointMaps = Record<string, EndpointMap>

type EndpointsByNamespace = Map<string, SerializedEndpointWithSchema[]>

// ─────────────────────────────────────────────────────────────────────────────
// Main Generator
// ─────────────────────────────────────────────────────────────────────────────

export async function generateApps(
  appSlug: string,
  appDeclarations: AppDeclarations,
  kernelClient: KernelClient,
  outputDir: string,
): Promise<{ generated: string[]; errors: string[]; endpointMaps: EndpointMaps }> {
  await mkdir(outputDir, { recursive: true })

  const generated: string[] = []
  const errors: string[] = []
  const endpointMaps: EndpointMaps = {}

  for (const [localName, declaration] of Object.entries(appDeclarations)) {
    try {
      const { slug, version } = parseDeclaration(declaration)
      // First resolve slug to appId
      const resolved = await kernelClient.resolveApplication(slug)
      // Then discover using appId
      const schema = await kernelClient.discoverApplication(resolved.appId, version)

      const { code, endpointMap } = generateAppApiCode(localName, slug, schema)
      await writeFile(path.join(outputDir, `${slug}.ts`), code)
      generated.push(localName)
      endpointMaps[localName] = endpointMap
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      errors.push(`${localName}: ${message}`)
    }
  }

  // Generate index file with module augmentation for automatic ctx.apps typing
  await writeFile(
    path.join(outputDir, 'index.ts'),
    generateIndexCode(appSlug, appDeclarations, generated),
  )

  // Format all generated files with prettier
  await formatGeneratedFiles(outputDir)

  return { generated, errors, endpointMaps }
}

// ─────────────────────────────────────────────────────────────────────────────
// Declaration Parser
// ─────────────────────────────────────────────────────────────────────────────

function parseDeclaration(declaration: string): { slug: string; version?: string } {
  const atIndex = declaration.lastIndexOf('@')
  if (atIndex > 0) {
    return {
      slug: declaration.slice(0, atIndex),
      version: declaration.slice(atIndex + 1),
    }
  }
  return { slug: declaration }
}

// ─────────────────────────────────────────────────────────────────────────────
// Code Generation
// ─────────────────────────────────────────────────────────────────────────────

function generateAppApiCode(
  localName: string,
  slug: string,
  schema: AppDiscoverResult,
): { code: string; endpointMap: EndpointMap } {
  const pascalName = toPascalCase(localName)
  const workerEndpoints = groupEndpointsByNamespace(schema.endpoints.worker)
  const backendEndpoints = groupEndpointsByNamespace(schema.endpoints.backend)

  // Build endpoint map: "worker.threads.create" -> "threads.create.v1"
  const endpointMap: EndpointMap = {}
  for (const [namespace, eps] of workerEndpoints) {
    for (const ep of eps) {
      const methodName = getMethodName(ep.baseName, namespace)
      const accessPath = `worker.${namespace}.${methodName}`
      endpointMap[accessPath] = ep.name
    }
  }
  for (const [namespace, eps] of backendEndpoints) {
    for (const ep of eps) {
      const methodName = getMethodName(ep.baseName, namespace)
      const accessPath = `backend.${namespace}.${methodName}`
      endpointMap[accessPath] = ep.name
    }
  }

  const lines: string[] = [
    `// AUTO-GENERATED - DO NOT EDIT`,
    `// Source: ${slug}@${schema.version}`,
    ``,
    `type CallFn = <T = unknown>(slug: string, endpoint: string, params: unknown) => Promise<T>`,
    ``,
  ]

  // Generate types for worker endpoints
  if (workerEndpoints.size > 0) {
    lines.push(`// Worker Endpoints`)
    lines.push(...generateNamespaceTypes(pascalName, 'Worker', workerEndpoints))
    lines.push(``)
  }

  // Generate types for backend endpoints
  if (backendEndpoints.size > 0) {
    lines.push(`// Backend Endpoints`)
    lines.push(...generateNamespaceTypes(pascalName, 'Backend', backendEndpoints))
    lines.push(``)
  }

  // Generate combined API type
  lines.push(`export type ${pascalName}Api = {`)
  if (workerEndpoints.size > 0) {
    lines.push(`  worker: ${pascalName}WorkerApi`)
  }
  if (backendEndpoints.size > 0) {
    lines.push(`  backend: ${pascalName}BackendApi`)
  }
  lines.push(`}`)
  lines.push(``)

  // Generate factory function
  lines.push(`export function create${pascalName}Api(call: CallFn): ${pascalName}Api {`)
  lines.push(`  return {`)
  if (workerEndpoints.size > 0) {
    lines.push(...generateNamespaceImplLines(slug, 'worker', workerEndpoints, 4))
    if (backendEndpoints.size > 0) {
      lines[lines.length - 1] += ','
    }
  }
  if (backendEndpoints.size > 0) {
    lines.push(...generateNamespaceImplLines(slug, 'backend', backendEndpoints, 4))
  }
  lines.push(`  }`)
  lines.push(`}`)

  return { code: lines.join('\n'), endpointMap }
}

function generateNamespaceTypes(
  pascalName: string,
  suffix: string,
  endpoints: EndpointsByNamespace,
): string[] {
  const lines: string[] = []

  // Generate namespace types
  for (const [namespace, eps] of endpoints) {
    const nsTypeName = `${pascalName}${suffix}${toPascalCase(namespace)}`
    lines.push(`type ${nsTypeName} = {`)
    for (const ep of eps) {
      const methodName = getMethodName(ep.baseName, namespace)
      const inputType = jsonSchemaToTypeString(ep.inputSchema)
      const outputType = ep.outputSchema ? jsonSchemaToTypeString(ep.outputSchema) : 'unknown'
      lines.push(`  ${methodName}(params: ${inputType}): Promise<${outputType}>`)
    }
    lines.push(`}`)
    lines.push(``)
  }

  // Generate combined type
  lines.push(`type ${pascalName}${suffix}Api = {`)
  for (const namespace of endpoints.keys()) {
    lines.push(`  ${namespace}: ${pascalName}${suffix}${toPascalCase(namespace)}`)
  }
  lines.push(`}`)

  return lines
}

function generateNamespaceImplLines(
  slug: string,
  type: 'worker' | 'backend',
  endpoints: EndpointsByNamespace,
  indent: number,
): string[] {
  const lines: string[] = []
  const spaces = ' '.repeat(indent)
  const namespacesArray = Array.from(endpoints.entries())

  lines.push(`${spaces}${type}: {`)

  for (let i = 0; i < namespacesArray.length; i++) {
    const [namespace, eps] = namespacesArray[i]!
    const isLastNamespace = i === namespacesArray.length - 1

    lines.push(`${spaces}  ${namespace}: {`)

    for (let j = 0; j < eps.length; j++) {
      const ep = eps[j]!
      const methodName = getMethodName(ep.baseName, namespace)
      const comma = j < eps.length - 1 ? ',' : ''
      lines.push(
        `${spaces}    ${methodName}: (params) => call("${slug}", "${ep.name}", params)${comma}`,
      )
    }

    lines.push(`${spaces}  }${isLastNamespace ? '' : ','}`)
  }

  lines.push(`${spaces}}`)

  return lines
}

function generateIndexCode(
  appSlug: string,
  declarations: AppDeclarations,
  generated: string[],
): string {
  const lines: string[] = [
    `// AUTO-GENERATED - DO NOT EDIT`,
    ``,
    `type CallFn = <T = unknown>(slug: string, endpoint: string, params: unknown) => Promise<T>`,
    ``,
  ]

  // Import all generated APIs
  for (const localName of generated) {
    const slug = parseDeclaration(declarations[localName]!).slug
    const pascalName = toPascalCase(localName)
    lines.push(`import { create${pascalName}Api, type ${pascalName}Api } from "./${slug}"`)
  }

  lines.push(``)

  // Export types
  lines.push(`export type {`)
  for (const localName of generated) {
    const pascalName = toPascalCase(localName)
    lines.push(`  ${pascalName}Api,`)
  }
  lines.push(`}`)
  lines.push(``)

  // Generate combined Apps type
  lines.push(`export type GeneratedApps = {`)
  for (const localName of generated) {
    const pascalName = toPascalCase(localName)
    lines.push(`  ${localName}: ${pascalName}Api`)
  }
  lines.push(`}`)
  lines.push(``)

  // Module augmentation for automatic ctx.apps typing
  lines.push(`// Module augmentation for automatic ctx.apps typing`)
  lines.push(`declare module "@astrale-os/sdk-app" {`)
  lines.push(`  interface AppAppsRegistry {`)
  lines.push(`    "${appSlug}": GeneratedApps`)
  lines.push(`  }`)
  lines.push(`}`)
  lines.push(``)

  // Generate factory
  lines.push(`export function createApps(call: CallFn): GeneratedApps {`)
  lines.push(`  return {`)
  for (const localName of generated) {
    const pascalName = toPascalCase(localName)
    lines.push(`    ${localName}: create${pascalName}Api(call),`)
  }
  lines.push(`  }`)
  lines.push(`}`)

  return lines.join('\n')
}

// ─────────────────────────────────────────────────────────────────────────────
// Prettier Formatting
// ─────────────────────────────────────────────────────────────────────────────

async function formatGeneratedFiles(outputDir: string): Promise<void> {
  try {
    execSync(`prettier --write "${outputDir}/*.ts"`, {
      stdio: 'pipe',
    })
  } catch {
    // Silently ignore prettier errors - formatting is optional
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function groupEndpointsByNamespace(
  endpoints: Record<string, SerializedEndpointWithSchema>,
): EndpointsByNamespace {
  const grouped = new Map<string, SerializedEndpointWithSchema[]>()

  for (const endpoint of Object.values(endpoints)) {
    const parts = endpoint.baseName.split('.')
    const namespace = parts.length > 1 ? parts[0]! : 'default'

    if (!grouped.has(namespace)) {
      grouped.set(namespace, [])
    }
    grouped.get(namespace)!.push(endpoint)
  }

  return grouped
}

function getMethodName(baseName: string, namespace: string): string {
  const parts = baseName.split('.')
  if (parts.length > 1 && parts[0] === namespace) {
    return parts.slice(1).join('_')
  }
  return baseName.replace(/\./g, '_')
}

function toPascalCase(str: string): string {
  return str
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

function jsonSchemaToTypeString(schema: Record<string, unknown> | undefined): string {
  if (!schema) return 'unknown'

  const type = schema.type as string | undefined

  // Handle empty schema {} (represents "any" from unrepresentable transforms)
  // Default to string since most transforms (moduleId, typeId, etc.) are branded strings
  if (!type && Object.keys(schema).filter((k) => k !== '$schema').length === 0) {
    return 'string'
  }

  // Handle anyOf (used for nullable types like z.string().nullable())
  const anyOf = schema.anyOf as Array<Record<string, unknown>> | undefined
  if (anyOf) {
    const types = anyOf.map((s) => jsonSchemaToTypeString(s))
    return types.join(' | ')
  }

  // Handle oneOf (similar to anyOf)
  const oneOf = schema.oneOf as Array<Record<string, unknown>> | undefined
  if (oneOf) {
    const types = oneOf.map((s) => jsonSchemaToTypeString(s))
    return types.join(' | ')
  }

  if (type === 'object') {
    const properties = schema.properties as Record<string, Record<string, unknown>> | undefined
    if (!properties) return 'Record<string, unknown>'

    const required = new Set((schema.required as string[]) ?? [])
    const props = Object.entries(properties).map(([key, propSchema]) => {
      const optional = required.has(key) ? '' : '?'
      // Handle empty property schema (from transforms like moduleId())
      const propType = jsonSchemaToTypeString(propSchema)
      return `${key}${optional}: ${propType}`
    })

    return `{ ${props.join('; ')} }`
  }

  if (type === 'array') {
    const items = schema.items as Record<string, unknown> | undefined
    return `Array<${jsonSchemaToTypeString(items)}>`
  }

  if (type === 'string') return 'string'
  if (type === 'number' || type === 'integer') return 'number'
  if (type === 'boolean') return 'boolean'
  if (type === 'null') return 'null'

  if (Array.isArray(type)) {
    return type.map((t) => jsonSchemaToTypeString({ type: t })).join(' | ')
  }

  // Handle empty property schema (no type field, just empty object)
  // Default to string since most transforms (moduleId, typeId, etc.) are branded strings
  if (Object.keys(schema).length === 0) {
    return 'string'
  }

  return 'unknown'
}
