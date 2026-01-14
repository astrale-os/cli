/**
 * App Definition Loader
 *
 * Dynamically loads and serializes an app definition from the entry file.
 */

import type { SerializedApp, SerializedEndpoint } from "@astrale-os/sdk-app"
import * as fs from "fs"
import path from "path"
import {
  parseProjectEndpointJSDocs,
  findEndpointFiles,
  type EndpointJSDocMap,
} from "./jsdoc-parser"

type SkeletonNode = {
  name: string
  type: string
  data?: unknown
  children?: Record<string, SkeletonNode>
}

export type AppdataWithData = {
  avatar: Record<string, SkeletonNode>
  space: Record<string, SkeletonNode>
  global: Record<string, SkeletonNode>
}

export interface LoadedApp {
  serialized: SerializedApp
  appdata: AppdataWithData
  slug: string
  name: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap Data Extraction
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract bootstrap data from app definition into a path -> data map.
 * Paths match the format returned by kernel (e.g., "global/models/gpt-4o").
 */
export function extractBootstrapData(appdata: AppdataWithData): Map<string, unknown> {
  const result = new Map<string, unknown>()

  function traverse(node: SkeletonNode, nodePath: string) {
    if (node.data !== undefined) {
      result.set(nodePath, node.data)
    }
    if (node.children) {
      for (const [key, child] of Object.entries(node.children)) {
        traverse(child, `${nodePath}/${key}`)
      }
    }
  }

  for (const [scope, nodes] of Object.entries(appdata)) {
    for (const [key, node] of Object.entries(nodes)) {
      traverse(node, `${scope}/${key}`)
    }
  }

  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// App Definition Discovery
// ─────────────────────────────────────────────────────────────────────────────

type AppDefinition = {
  serialize: () => SerializedApp
  appdata: AppdataWithData
}

function isAppDefinition(value: unknown): value is AppDefinition {
  return (
    value !== null &&
    typeof value === "object" &&
    "serialize" in value &&
    "appdata" in value &&
    typeof (value as { serialize: unknown }).serialize === "function"
  )
}

/**
 * Find an AppDefinition in a module's exports.
 */
function findAppDefinition(appModule: Record<string, unknown>): AppDefinition | null {
  // Check common export names first
  for (const name of ["App", "app", "default"]) {
    const candidate = appModule[name]
    if (isAppDefinition(candidate)) return candidate

    // Check nested default.app pattern
    if (name === "default" && candidate && typeof candidate === "object") {
      const nested = (candidate as Record<string, unknown>).app
      if (isAppDefinition(nested)) return nested
    }
  }

  // Scan all exports
  for (const [key, value] of Object.entries(appModule)) {
    if (key !== "__esModule" && isAppDefinition(value)) {
      return value
    }
  }

  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// App Loading
// ─────────────────────────────────────────────────────────────────────────────

const APP_CANDIDATES = [
  "src/schema.ts",
  "src/app.ts",
  "schema.ts",
  "app.ts",
  "src/index.ts",
  "index.ts",
]

/**
 * Load and serialize an app definition from a specific entry file.
 */
export async function loadAppDefinition(entryPath: string): Promise<LoadedApp> {
  const absolutePath = path.resolve(entryPath)
  const projectDir = findProjectDir(absolutePath)

  // Import endpoint files first to register them with the app instance
  if (projectDir) {
    await importEndpointFiles(projectDir)
  }

  // Import the app (without cache-busting to get the same instance endpoints registered on)
  const appModule = await import(absolutePath)
  const app = findAppDefinition(appModule)

  if (!app) {
    throw new Error(
      `Could not find AppDefinition in ${entryPath}.\n` +
        `Make sure the file exports an app created with defineApp().`,
    )
  }

  return {
    serialized: app.serialize(),
    appdata: app.appdata,
    slug: app.serialize().app.slug,
    name: app.serialize().app.name,
  }
}

/**
 * Load app definition by searching common file locations in a project directory.
 */
export async function loadAppFromDirectory(projectDir: string): Promise<LoadedApp> {
  let loadedApp: LoadedApp | null = null

  for (const candidate of APP_CANDIDATES) {
    const appPath = path.join(projectDir, candidate)
    if (!fs.existsSync(appPath)) continue

    try {
      loadedApp = await loadAppDefinition(appPath)
      break
    } catch {
      // Try next candidate
    }
  }

  if (!loadedApp) {
    throw new Error(
      `Could not find app definition in ${projectDir}.\nLooked for: ${APP_CANDIDATES.join(", ")}`,
    )
  }

  // Enrich endpoints with JSDoc documentation
  const jsdocMap = parseProjectEndpointJSDocs(projectDir)
  loadedApp.serialized = enrichEndpointsWithJSDocs(loadedApp.serialized, jsdocMap)

  return loadedApp
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Find project directory by walking up from a file path looking for .astrale/config.json.
 */
function findProjectDir(fromPath: string): string | null {
  let dir = path.dirname(fromPath)
  const root = path.parse(dir).root

  while (dir !== root) {
    if (fs.existsSync(path.join(dir, ".astrale", "config.json"))) {
      return dir
    }
    dir = path.dirname(dir)
  }

  return null
}

/**
 * Import endpoint files to trigger registration with the app.
 * Endpoints call app.workerEndpoint() or app.backendEndpoint() which registers them.
 */
async function importEndpointFiles(projectDir: string): Promise<void> {
  const dirsToScan = [
    path.join(projectDir, "src"),
    path.join(projectDir, "backend", "src"),
    path.join(projectDir, "worker", "src"),
    path.join(projectDir, "..", "backend", "src"), // Monorepo structure
    path.join(projectDir, "..", "worker", "src"),
  ]

  for (const dir of dirsToScan) {
    if (!fs.existsSync(dir)) continue

    for (const filePath of findEndpointFiles(dir)) {
      try {
        await import(`${filePath}?t=${Date.now()}`)
      } catch {
        // Expected for backend endpoints with runtime dependencies
      }
    }
  }
}

/**
 * Enrich serialized endpoints with JSDoc documentation.
 */
function enrichEndpointsWithJSDocs(
  serialized: SerializedApp,
  jsdocMap: EndpointJSDocMap,
): SerializedApp {
  const enrichEndpoint = (endpoint: SerializedEndpoint): SerializedEndpoint => {
    const jsdoc = jsdocMap.get(endpoint.name)
    if (!jsdoc) return endpoint

    return {
      ...endpoint,
      documentation: endpoint.documentation ?? jsdoc.documentation,
      deprecated: endpoint.deprecated ?? jsdoc.deprecated,
    }
  }

  return {
    ...serialized,
    endpoints: {
      worker: Object.fromEntries(
        Object.entries(serialized.endpoints.worker).map(([k, e]) => [k, enrichEndpoint(e)]),
      ),
      backend: Object.fromEntries(
        Object.entries(serialized.endpoints.backend).map(([k, e]) => [k, enrichEndpoint(e)]),
      ),
    },
  }
}
