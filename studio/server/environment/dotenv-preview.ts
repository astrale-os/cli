/**
 * Isolated preview of an adapter secrets file for Studio's editor.
 *
 * The SDK adapter remains authoritative when deploying. It is not a runtime
 * dependency of the raw Studio server shipped inside the CLI package, so this
 * isolated parser intentionally mirrors only the SDK's documented dotenv
 * subset and never mutates process.env.
 */
export function parseDotenvPreview(contents: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const raw of contents.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const match = /^(?:export\s+)?([A-Za-z_]\w*)\s*=\s*(.*)$/.exec(line)
    if (!match) continue
    const key = match[1]!
    let value = match[2]!.trim()
    const singleQuoted = value.length >= 2 && value.startsWith("'") && value.endsWith("'")
    if (singleQuoted || (value.length >= 2 && value.startsWith('"') && value.endsWith('"'))) {
      value = value.slice(1, -1)
    }
    values[key] = singleQuoted
      ? value
      : value.replace(/\$\{(\w+)\}/g, (_, name: string) => values[name] ?? '')
  }
  return values
}
