import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Node, Project, type SourceFile } from 'ts-morph'

export function readTextSafe(file: string): string {
  try {
    return existsSync(file) ? readFileSync(file, 'utf8') : ''
  } catch {
    return ''
  }
}

export function listFiles(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((e) => {
        try {
          return statSync(join(dir, e)).isFile()
        } catch {
          return false
        }
      })
      .sort()
  } catch {
    return []
  }
}

export function listDirs(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((e) => {
        try {
          return statSync(join(dir, e)).isDirectory()
        } catch {
          return false
        }
      })
      .sort()
  } catch {
    return []
  }
}

const SOURCE_FILE = /\.[cm]?[jt]sx?$/
const SKIP_SOURCE_DIRS = new Set(['__tests__', 'node_modules', '.git', '.astrale', '.dist', 'dist'])

export function listSourceFiles(dir: string): string[] {
  const files: string[] = []
  const walk = (current: string) => {
    let entries: string[]
    try {
      entries = readdirSync(current).sort()
    } catch {
      return
    }
    for (const entry of entries) {
      if (SKIP_SOURCE_DIRS.has(entry)) continue
      const file = join(current, entry)
      let stat
      try {
        stat = statSync(file)
      } catch {
        continue
      }
      if (stat.isDirectory()) walk(file)
      else if (
        stat.isFile() &&
        SOURCE_FILE.test(entry) &&
        !entry.endsWith('.d.ts') &&
        !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(entry)
      ) {
        files.push(file)
      }
    }
  }
  walk(dir)
  return files
}

/** A throwaway in-memory ts-morph project (no tsconfig, no type-checking IO). */
export function makeProject(): Project {
  return new Project({
    useInMemoryFileSystem: false,
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    skipLoadingLibFiles: true,
    compilerOptions: { allowJs: true },
  })
}

export function addSource(project: Project, file: string): SourceFile | null {
  try {
    return project.getSourceFile(file) ?? project.addSourceFileAtPath(file)
  } catch {
    return null
  }
}

function unwrap(node: Node): Node {
  let current = node
  while (
    Node.isAsExpression(current) ||
    Node.isSatisfiesExpression(current) ||
    Node.isParenthesizedExpression(current) ||
    Node.isTypeAssertion(current) ||
    Node.isNonNullExpression(current)
  ) {
    current = current.getExpression()
  }
  return current
}

export function localValue(
  node: Node | undefined,
  source: SourceFile,
  seen = new Set<string>(),
): Node | null {
  if (!node) return null
  const value = unwrap(node)
  if (!Node.isIdentifier(value)) return value
  const key = `${source.getFilePath()}:${value.getText()}`
  if (seen.has(key)) return value
  seen.add(key)
  const init = source.getVariableDeclaration(value.getText())?.getInitializer()
  return init ? localValue(init, source, seen) : value
}

export function objectValue(node: Node | undefined, source: SourceFile): Node | null {
  const value = localValue(node, source)
  return value && Node.isObjectLiteralExpression(value) ? value : null
}

export function objectProperty(object: Node, name: string, source: SourceFile): Node | null {
  if (!Node.isObjectLiteralExpression(object)) return null
  for (const property of object.getProperties()) {
    if (Node.isPropertyAssignment(property) && property.getName() === name) {
      return localValue(property.getInitializer(), source)
    }
    if (Node.isShorthandPropertyAssignment(property) && property.getName() === name) {
      return localValue(property.getNameNode(), source)
    }
  }
  return null
}

export function literalString(node: Node | undefined, source: SourceFile): string | undefined {
  const value = localValue(node, source)
  if (!value) return undefined
  if (Node.isStringLiteral(value) || Node.isNoSubstitutionTemplateLiteral(value)) {
    return value.getLiteralValue()
  }
  return undefined
}

export function callName(node: Node | null): string | undefined {
  if (!node || !Node.isCallExpression(node)) return undefined
  const expression = node.getExpression()
  if (Node.isIdentifier(expression)) return expression.getText()
  if (Node.isPropertyAccessExpression(expression)) return expression.getName()
  return undefined
}

export function propertySlug(property: Node): string | undefined {
  if (!Node.isPropertyAssignment(property) && !Node.isShorthandPropertyAssignment(property)) {
    return undefined
  }
  const name = property.getNameNode()
  if (Node.isStringLiteral(name) || Node.isNoSubstitutionTemplateLiteral(name)) {
    return name.getLiteralValue()
  }
  return property.getName()
}

export function propertyValue(property: Node, source: SourceFile): Node | null {
  if (Node.isPropertyAssignment(property)) return localValue(property.getInitializer(), source)
  if (Node.isShorthandPropertyAssignment(property)) {
    return localValue(property.getNameNode(), source)
  }
  return null
}
