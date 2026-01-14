/**
 * Endpoint Usage Analyzer
 *
 * Analyzes TypeScript source files to detect cross-app endpoint calls.
 * Uses TypeScript's compiler API to find ctx.apps.X.Y.Z() patterns.
 */

import * as ts from "typescript"
import * as fs from "fs"
import * as path from "path"

import type { EndpointMaps } from "./apps-generator"

// =============================================================================
// Types
// =============================================================================

export type EndpointUsage = {
  /** Local name of the app (e.g., "chatMessage") */
  localName: string
  /** Target app slug (e.g., "chat-message") */
  targetSlug: string
  /** Versioned endpoint name (e.g., "threads.create.v1") */
  endpoint: string
  /** Source file path */
  file: string
  /** Line number in source file */
  line: number
}

export type AnalyzerResult = {
  usages: EndpointUsage[]
  errors: string[]
}

// =============================================================================
// Property Chain Extraction
// =============================================================================

type PropertyChain = {
  /** Full chain of property names (e.g., ["ctx", "apps", "chatMessage", "worker", "threads", "create"]) */
  parts: string[]
  /** The call expression node */
  callNode: ts.CallExpression
}

/**
 * Extract property access chain from a call expression.
 * Returns null if the expression is not a property access chain.
 */
function extractPropertyChain(node: ts.CallExpression): PropertyChain | null {
  const parts: string[] = []
  let current: ts.Expression = node.expression

  while (ts.isPropertyAccessExpression(current)) {
    parts.unshift(current.name.text)
    current = current.expression
  }

  if (ts.isIdentifier(current)) {
    parts.unshift(current.text)
    return { parts, callNode: node }
  }

  // Handle `this.ctx.apps...` pattern
  if (
    ts.isPropertyAccessExpression(current) &&
    current.expression.kind === ts.SyntaxKind.ThisKeyword
  ) {
    parts.unshift(current.name.text)
    parts.unshift("this")
    return { parts, callNode: node }
  }

  return parts.length > 0 ? { parts, callNode: node } : null
}

/**
 * Check if a property chain is an apps access pattern.
 * Returns the local name and access path if it matches.
 */
function parseAppsAccess(chain: PropertyChain): { localName: string; accessPath: string } | null {
  const { parts } = chain

  // Find "apps" in the chain
  const appsIndex = parts.findIndex((p) => p === "apps")
  if (appsIndex === -1) return null

  // Must have at least: apps.localName.worker|backend.namespace.method
  // That's 5 parts after "apps"
  const afterApps = parts.slice(appsIndex + 1)
  if (afterApps.length < 4) return null

  const [localName, serviceType, namespace, method] = afterApps
  if (!localName || !serviceType || !namespace || !method) return null

  // Service type must be "worker" or "backend"
  if (serviceType !== "worker" && serviceType !== "backend") return null

  // Build access path: "worker.threads.create"
  const accessPath = `${serviceType}.${namespace}.${method}`

  return { localName, accessPath }
}

// =============================================================================
// Variable Tracking
// =============================================================================

type VariableBinding = {
  /** The local name of the app (e.g., "chatMessage") */
  localName: string
  /** How many levels deep from ctx.apps (0 = direct reference to ctx.apps.X) */
  depth: number
}

/**
 * Track variable bindings for destructuring and aliasing patterns.
 */
class VariableTracker {
  private bindings = new Map<string, VariableBinding>()

  /**
   * Record a variable binding.
   * @param varName - The variable name being bound
   * @param localName - The app local name it refers to
   * @param depth - How deep in the chain (0 = ctx.apps.X, 1 = ctx.apps.X.worker, etc.)
   */
  addBinding(varName: string, localName: string, depth: number): void {
    this.bindings.set(varName, { localName, depth })
  }

  /**
   * Get binding for a variable name.
   */
  getBinding(varName: string): VariableBinding | undefined {
    return this.bindings.get(varName)
  }

  /**
   * Check if a property chain starts with a tracked variable.
   * Returns the resolved local name and remaining path if found.
   */
  resolveChain(parts: string[]): { localName: string; remainingPath: string[] } | null {
    if (parts.length === 0) return null

    const firstPart = parts[0]!
    const binding = this.bindings.get(firstPart)
    if (!binding) return null

    // The remaining path depends on the binding depth
    // depth 0: variable is ctx.apps.X, so remaining is parts[1:]
    // depth 1: variable is ctx.apps.X.worker, so remaining is parts[1:]
    return {
      localName: binding.localName,
      remainingPath: parts.slice(1),
    }
  }
}

// =============================================================================
// AST Visitor
// =============================================================================

/**
 * Visit a source file and extract endpoint usages.
 */
function visitSourceFile(
  sourceFile: ts.SourceFile,
  endpointMaps: EndpointMaps,
  appDeclarations: Record<string, string>,
): { usages: EndpointUsage[]; errors: string[] } {
  const usages: EndpointUsage[] = []
  const errors: string[] = []
  const tracker = new VariableTracker()

  function getLineNumber(node: ts.Node): number {
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart())
    return line + 1 // 1-indexed
  }

  function visit(node: ts.Node): void {
    // Track variable declarations for destructuring/aliasing
    if (ts.isVariableDeclaration(node) && node.initializer) {
      trackVariableDeclaration(node, tracker)
    }

    // Look for call expressions
    if (ts.isCallExpression(node)) {
      const chain = extractPropertyChain(node)
      if (chain) {
        const usage = resolveEndpointUsage(
          chain,
          tracker,
          endpointMaps,
          appDeclarations,
          sourceFile.fileName,
          getLineNumber(node),
        )
        if (usage) {
          if ("error" in usage) {
            errors.push(usage.error)
          } else {
            usages.push(usage)
          }
        }
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return { usages, errors }
}

/**
 * Track variable declarations for destructuring and aliasing.
 */
function trackVariableDeclaration(node: ts.VariableDeclaration, tracker: VariableTracker): void {
  const init = node.initializer
  if (!init) return

  // Handle aliasing: const cm = ctx.apps.chatMessage
  if (ts.isIdentifier(node.name) && ts.isPropertyAccessExpression(init)) {
    const chain = extractChainFromExpression(init)
    if (chain) {
      const appsIndex = chain.findIndex((p) => p === "apps")
      if (appsIndex !== -1 && chain.length > appsIndex + 1) {
        const localName = chain[appsIndex + 1]!
        const depth = chain.length - appsIndex - 2 // How many levels after localName
        tracker.addBinding(node.name.text, localName, depth)
      }
    }
  }

  // Handle destructuring: const { chatMessage } = ctx.apps
  if (ts.isObjectBindingPattern(node.name) && ts.isPropertyAccessExpression(init)) {
    const chain = extractChainFromExpression(init)
    if (chain) {
      const lastPart = chain[chain.length - 1]
      if (lastPart === "apps") {
        // Destructuring from ctx.apps
        for (const element of node.name.elements) {
          if (ts.isBindingElement(element) && ts.isIdentifier(element.name)) {
            const localName = element.propertyName
              ? ts.isIdentifier(element.propertyName)
                ? element.propertyName.text
                : element.name.text
              : element.name.text
            tracker.addBinding(element.name.text, localName, 0)
          }
        }
      }
    }
  }
}

/**
 * Extract property chain from an expression (not a call).
 */
function extractChainFromExpression(expr: ts.Expression): string[] | null {
  const parts: string[] = []
  let current: ts.Expression = expr

  while (ts.isPropertyAccessExpression(current)) {
    parts.unshift(current.name.text)
    current = current.expression
  }

  if (ts.isIdentifier(current)) {
    parts.unshift(current.text)
    return parts
  }

  return parts.length > 0 ? parts : null
}

/**
 * Resolve a property chain to an endpoint usage.
 */
function resolveEndpointUsage(
  chain: PropertyChain,
  tracker: VariableTracker,
  endpointMaps: EndpointMaps,
  appDeclarations: Record<string, string>,
  file: string,
  line: number,
): EndpointUsage | { error: string } | null {
  const { parts } = chain

  // Try direct pattern: ctx.apps.chatMessage.worker.threads.create()
  const directAccess = parseAppsAccess(chain)
  if (directAccess) {
    return resolveFromAccessPath(
      directAccess.localName,
      directAccess.accessPath,
      endpointMaps,
      appDeclarations,
      file,
      line,
    )
  }

  // Try tracked variable pattern
  const resolved = tracker.resolveChain(parts)
  if (resolved) {
    const { localName, remainingPath } = resolved

    // Need at least: worker|backend.namespace.method
    if (remainingPath.length < 3) return null

    const [serviceType, namespace, method] = remainingPath
    if (!serviceType || !namespace || !method) return null
    if (serviceType !== "worker" && serviceType !== "backend") return null

    const accessPath = `${serviceType}.${namespace}.${method}`
    return resolveFromAccessPath(localName, accessPath, endpointMaps, appDeclarations, file, line)
  }

  return null
}

/**
 * Resolve an access path to an endpoint usage.
 */
function resolveFromAccessPath(
  localName: string,
  accessPath: string,
  endpointMaps: EndpointMaps,
  appDeclarations: Record<string, string>,
  file: string,
  line: number,
): EndpointUsage | { error: string } | null {
  // Check if localName is a declared app
  const targetSlug = appDeclarations[localName]
  if (!targetSlug) {
    // Not a declared app dependency, ignore
    return null
  }

  // Get endpoint map for this app
  const endpointMap = endpointMaps[localName]
  if (!endpointMap) {
    return {
      error: `${file}:${line}: No endpoint map found for app "${localName}"`,
    }
  }

  // Look up the endpoint name
  const endpoint = endpointMap[accessPath]
  if (!endpoint) {
    return {
      error: `${file}:${line}: Unknown endpoint "${accessPath}" for app "${localName}"`,
    }
  }

  // Parse slug from declaration (handle "slug@version" format)
  const slug = targetSlug.includes("@")
    ? targetSlug.slice(0, targetSlug.lastIndexOf("@"))
    : targetSlug

  return {
    localName,
    targetSlug: slug,
    endpoint,
    file,
    line,
  }
}

// =============================================================================
// Main API
// =============================================================================

/**
 * Analyze a project directory for endpoint usages.
 *
 * @param projectDir - Project root directory
 * @param endpointMaps - Maps from generateApps()
 * @param appDeclarations - App declarations from the app definition
 * @returns List of endpoint usages and any errors
 */
export function analyzeEndpointUsages(
  projectDir: string,
  endpointMaps: EndpointMaps,
  appDeclarations: Record<string, string>,
): AnalyzerResult {
  const allUsages: EndpointUsage[] = []
  const allErrors: string[] = []

  // Find all TypeScript files in the project
  const sourceFiles = findSourceFiles(projectDir)

  for (const filePath of sourceFiles) {
    const content = fs.readFileSync(filePath, "utf-8")

    // Quick check: skip files that don't reference apps
    if (!content.includes(".apps.") && !content.includes("ctx.apps")) {
      continue
    }

    const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true)

    const { usages, errors } = visitSourceFile(sourceFile, endpointMaps, appDeclarations)

    allUsages.push(...usages)
    allErrors.push(...errors)
  }

  // Deduplicate usages (same endpoint might be called multiple times)
  const uniqueUsages = deduplicateUsages(allUsages)

  return { usages: uniqueUsages, errors: allErrors }
}

/**
 * Find all TypeScript source files in a directory.
 */
function findSourceFiles(dirPath: string): string[] {
  const results: string[] = []

  function scan(dir: string): void {
    if (!fs.existsSync(dir)) return

    const entries = fs.readdirSync(dir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        // Skip node_modules, .astrale, and hidden directories
        if (
          entry.name === "node_modules" ||
          entry.name === ".astrale" ||
          entry.name.startsWith(".")
        ) {
          continue
        }
        scan(fullPath)
      } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
        // Skip declaration files
        if (entry.name.endsWith(".d.ts")) continue
        results.push(fullPath)
      }
    }
  }

  // Scan src directory
  scan(path.join(dirPath, "src"))

  // Also scan root level files
  const rootFiles = fs.readdirSync(dirPath, { withFileTypes: true })
  for (const entry of rootFiles) {
    if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      results.push(path.join(dirPath, entry.name))
    }
  }

  return results
}

/**
 * Deduplicate usages by (targetSlug, endpoint) pair.
 * Keeps the first occurrence of each unique endpoint call.
 */
function deduplicateUsages(usages: EndpointUsage[]): EndpointUsage[] {
  const seen = new Set<string>()
  const unique: EndpointUsage[] = []

  for (const usage of usages) {
    const key = `${usage.targetSlug}:${usage.endpoint}`
    if (!seen.has(key)) {
      seen.add(key)
      unique.push(usage)
    }
  }

  return unique
}
