import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

function identifier(text: string, fallback: string): string {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
  if (words.length === 0) return fallback
  return words
    .map((word, index) => (index === 0 ? word : word[0].toUpperCase() + word.slice(1)))
    .join('')
}

/** Apply the deterministic schema edit used by the local mock harness. */
export function applyMockDomainEdit(
  root: string,
  instruction: string,
): { file: string; prop: string } | null {
  const schemaDir = join(root, 'schema')
  if (!existsSync(schemaDir)) return null
  const files = readdirSync(schemaDir).filter((file) => file.endsWith('.ts') && file !== 'index.ts')
  const propName = identifier(instruction, 'agentNote')
  for (const file of files) {
    const absolute = join(schemaDir, file)
    const source = readFileSync(absolute, 'utf8')
    const props = source.indexOf('props: {')
    if (props < 0) continue
    let prop = propName
    let suffix = 2
    while (new RegExp(`\\b${prop}\\b\\s*:`).test(source)) prop = `${propName}${suffix++}`
    const insertAt = props + 'props: {'.length
    const line = `\n    /** Added by the agent in response to a studio comment. */\n    ${prop}: z.string().optional(),`
    writeFileSync(absolute, source.slice(0, insertAt) + line + source.slice(insertAt))
    return { file: `schema/${file}`, prop }
  }
  return null
}
