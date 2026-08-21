/**
 * Static, non-authoritative preview of astrale.config.ts.
 *
 * Deployment configuration is owned by the SDK adapter and is executable
 * TypeScript. Studio deliberately does not execute it during anatomy/env reads;
 * these few fields are only display/editor hints and may be unknown when the
 * configuration is computed dynamically.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface ConfigPreview {
  adapter: 'astrale' | 'cloudflare' | 'unknown'
  prodTarget?: string
  devSecrets?: string
  configuredSecretFiles: string[]
}

function withoutComments(source: string): string {
  let output = ''
  let quote: "'" | '"' | '`' | null = null
  let escaped = false
  for (let index = 0; index < source.length; index++) {
    const char = source[index]!
    const next = source[index + 1]
    if (quote) {
      output += char
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === quote) quote = null
      continue
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char
      output += char
      continue
    }
    if (char === '/' && next === '/') {
      while (index + 1 < source.length && source[index + 1] !== '\n') index++
      continue
    }
    if (char === '/' && next === '*') {
      index += 2
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        if (source[index] === '\n') output += '\n'
        index++
      }
      index++
      continue
    }
    output += char
  }
  return output
}

function stringField(source: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}\\s*:\\s*(['"])(.*?)\\1`).exec(source)
  return match?.[2]
}

function objectBody(source: string, name: string): string | undefined {
  const start = new RegExp(`\\b${name}\\s*:\\s*\\{`).exec(source)
  if (!start) return undefined
  const opening = source.indexOf('{', start.index)
  let depth = 1
  let quote: "'" | '"' | '`' | null = null
  let escaped = false
  for (let index = opening + 1; index < source.length; index++) {
    const char = source[index]!
    if (quote) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === quote) quote = null
      continue
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char
      continue
    }
    if (char === '{') depth++
    else if (char === '}' && --depth === 0) return source.slice(opening + 1, index)
  }
  return undefined
}

export function parseConfigPreview(source: string): ConfigPreview {
  const active = withoutComments(source)
  const adapter: ConfigPreview['adapter'] = /\bastrale\s*\(/.test(active)
    ? 'astrale'
    : /\bcloudflare\s*\(/.test(active)
      ? 'cloudflare'
      : 'unknown'
  const prod = objectBody(active, 'prod') ?? active
  const dev = objectBody(active, 'dev') ?? ''
  const instance = stringField(prod, 'instance')
  const route = stringField(prod, 'route')
  const configuredSecretFiles = [...active.matchAll(/\bsecrets\s*:\s*(['"])(.*?)\1/g)].map(
    (match) => match[2]!,
  )
  const devSecrets = stringField(dev, 'secrets')
  return {
    adapter,
    ...(instance
      ? { prodTarget: `instance: ${instance}` }
      : route
        ? { prodTarget: `route: ${route}` }
        : {}),
    ...(devSecrets ? { devSecrets } : {}),
    configuredSecretFiles: [...new Set(configuredSecretFiles)],
  }
}

export function readConfigPreview(root: string): ConfigPreview {
  try {
    return parseConfigPreview(readFileSync(join(root, 'astrale.config.ts'), 'utf8'))
  } catch {
    return { adapter: 'unknown', configuredSecretFiles: [] }
  }
}
