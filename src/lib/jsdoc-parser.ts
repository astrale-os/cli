/**
 * JSDoc Parser
 *
 * Extracts JSDoc documentation and @deprecated tags from endpoint definitions.
 * Uses TypeScript's compiler API to parse source files.
 */

import * as ts from "typescript"
import * as fs from "fs"
import * as path from "path"

// =============================================================================
// Types
// =============================================================================

export type EndpointJSDocInfo = {
  /** Documentation text (from JSDoc comment, excluding deprecated) */
  documentation?: string
  /** Deprecation message or true if deprecated tag found */
  deprecated?: boolean | string
}

export type EndpointJSDocMap = Map<string, EndpointJSDocInfo>

// =============================================================================
// JSDoc Extraction
// =============================================================================

/**
 * Extract JSDoc comment text from a node.
 * Returns the documentation text and deprecated info.
 */
function extractJSDoc(node: ts.Node, sourceFile: ts.SourceFile): EndpointJSDocInfo {
  const result: EndpointJSDocInfo = {}

  // Get leading comment ranges
  const fullText = sourceFile.getFullText()
  const leadingComments = ts.getLeadingCommentRanges(fullText, node.getFullStart())

  if (!leadingComments || leadingComments.length === 0) {
    return result
  }

  // Find the last JSDoc comment (closest to the node)
  for (let i = leadingComments.length - 1; i >= 0; i--) {
    const comment = leadingComments[i]
    if (!comment) continue
    const commentText = fullText.slice(comment.pos, comment.end)

    // Check if it's a JSDoc comment (starts with /**)
    if (commentText.startsWith("/**")) {
      const parsed = parseJSDocComment(commentText)
      result.documentation = parsed.documentation
      if (parsed.deprecated !== undefined) {
        result.deprecated = parsed.deprecated
      }
      break
    }
  }

  return result
}

/**
 * Parse a JSDoc comment string.
 * Extracts the main documentation and @deprecated tag.
 */
function parseJSDocComment(comment: string): EndpointJSDocInfo {
  const result: EndpointJSDocInfo = {}

  // Remove comment markers: /** ... */
  let content = comment.slice(3, -2)

  // Split into lines and clean up
  const lines = content.split("\n").map((line) => {
    // Remove leading asterisks and whitespace
    return line.replace(/^\s*\*\s?/, "").trim()
  })

  const docLines: string[] = []
  let deprecated: boolean | string | undefined

  for (const line of lines) {
    // Check for @deprecated tag
    if (line.startsWith("@deprecated")) {
      const message = line.slice("@deprecated".length).trim()
      deprecated = message || true
      continue
    }

    // Skip other tags
    if (line.startsWith("@")) {
      continue
    }

    // Add to documentation
    if (line || docLines.length > 0) {
      docLines.push(line)
    }
  }

  // Trim trailing empty lines
  while (docLines.length > 0 && docLines[docLines.length - 1] === "") {
    docLines.pop()
  }

  if (docLines.length > 0) {
    result.documentation = docLines.join("\n")
  }

  if (deprecated !== undefined) {
    result.deprecated = deprecated
  }

  return result
}

// =============================================================================
// Endpoint Detection
// =============================================================================

/**
 * Check if a call expression is an endpoint definition.
 * Looks for patterns like:
 * - App.workerEndpoint({ name: "...", ... })
 * - App.backendEndpoint({ name: "...", ... })
 */
function isEndpointCall(
  node: ts.CallExpression,
): { type: "worker" | "backend"; name: string; version: number } | null {
  // Check for property access like App.workerEndpoint
  if (!ts.isPropertyAccessExpression(node.expression)) {
    return null
  }

  const methodName = node.expression.name.text
  if (methodName !== "workerEndpoint" && methodName !== "backendEndpoint") {
    return null
  }

  // Extract endpoint name and version from the config object
  const configArg = node.arguments[0]
  if (!configArg || !ts.isObjectLiteralExpression(configArg)) {
    return null
  }

  let name: string | undefined
  let version = 1

  for (const prop of configArg.properties) {
    if (!ts.isPropertyAssignment(prop)) continue
    const propName = prop.name.getText()

    if (propName === "name" && ts.isStringLiteral(prop.initializer)) {
      name = prop.initializer.text
    }
    if (propName === "version" && ts.isNumericLiteral(prop.initializer)) {
      version = parseInt(prop.initializer.text, 10)
    }
  }

  if (!name) {
    return null
  }

  return {
    type: methodName === "workerEndpoint" ? "worker" : "backend",
    name,
    version,
  }
}

/**
 * Find the ancestor variable declaration for a node.
 * This helps us get the JSDoc from the variable declaration.
 */
function findVariableDeclarationAncestor(node: ts.Node): ts.VariableStatement | null {
  let current: ts.Node | undefined = node
  while (current) {
    if (ts.isVariableStatement(current)) {
      return current
    }
    current = current.parent
  }
  return null
}

// =============================================================================
// Main Parser
// =============================================================================

/**
 * Parse a TypeScript source file and extract JSDoc info for all endpoints.
 *
 * @param filePath - Path to the TypeScript file
 * @returns Map of versioned endpoint names to their JSDoc info
 */
export function parseEndpointJSDocs(filePath: string): EndpointJSDocMap {
  const results = new Map<string, EndpointJSDocInfo>()

  if (!fs.existsSync(filePath)) {
    return results
  }

  const content = fs.readFileSync(filePath, "utf-8")
  const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true)

  function visit(node: ts.Node) {
    // Look for call expressions that might be endpoint definitions
    if (ts.isCallExpression(node)) {
      const endpoint = isEndpointCall(node)
      if (endpoint) {
        // Get JSDoc from the variable declaration (if any)
        const varDecl = findVariableDeclarationAncestor(node)
        const jsdocNode = varDecl || node

        const jsdoc = extractJSDoc(jsdocNode, sourceFile)
        const versionedName = `${endpoint.name}.v${endpoint.version}`

        results.set(versionedName, jsdoc)
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return results
}

/**
 * Parse multiple files and merge JSDoc info.
 *
 * @param filePaths - Array of paths to TypeScript files
 * @returns Combined map of versioned endpoint names to their JSDoc info
 */
export function parseEndpointJSDocsFromFiles(filePaths: string[]): EndpointJSDocMap {
  const results = new Map<string, EndpointJSDocInfo>()

  for (const filePath of filePaths) {
    const fileResults = parseEndpointJSDocs(filePath)
    for (const [name, info] of fileResults) {
      results.set(name, info)
    }
  }

  return results
}

/**
 * Scan a directory recursively for TypeScript files containing endpoints.
 *
 * @param dirPath - Directory to scan
 * @returns Array of file paths that might contain endpoints
 */
export function findEndpointFiles(dirPath: string): string[] {
  const results: string[] = []

  if (!fs.existsSync(dirPath)) {
    return results
  }

  function scan(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        // Skip node_modules and hidden directories
        if (entry.name === "node_modules" || entry.name.startsWith(".")) {
          continue
        }
        scan(fullPath)
      } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
        // Check if file might contain endpoints
        const content = fs.readFileSync(fullPath, "utf-8")
        if (content.includes("workerEndpoint") || content.includes("backendEndpoint")) {
          results.push(fullPath)
        }
      }
    }
  }

  scan(dirPath)
  return results
}

/**
 * Parse all endpoint JSDoc info from a project directory.
 *
 * @param projectDir - Project root directory
 * @returns Map of versioned endpoint names to their JSDoc info
 */
export function parseProjectEndpointJSDocs(projectDir: string): EndpointJSDocMap {
  const srcDir = path.join(projectDir, "src")
  const endpointFiles = findEndpointFiles(srcDir)

  // Also check root level files
  const rootFiles = ["schema.ts", "app.ts", "index.ts"].map((f) => path.join(projectDir, f))
  for (const f of rootFiles) {
    if (fs.existsSync(f)) {
      const content = fs.readFileSync(f, "utf-8")
      if (content.includes("workerEndpoint") || content.includes("backendEndpoint")) {
        endpointFiles.push(f)
      }
    }
  }

  return parseEndpointJSDocsFromFiles(endpointFiles)
}
