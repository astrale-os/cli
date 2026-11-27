/**
 * The Domain's own installed platform tooling, found the way Node resolves packages from the
 * Domain's root: the nearest `node_modules` up the tree. The Studio never substitutes its own
 * SDK for a Domain's: every judgement comes from the SDK the Domain builds with.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { asJsonRecord, asString, parseJson } from '../../json'

function nearest(root: string, relativePath: string): string | null {
  let directory = root
  for (;;) {
    const candidate = join(directory, 'node_modules', relativePath)
    if (existsSync(candidate)) return candidate
    const parent = dirname(directory)
    if (parent === directory) return null
    directory = parent
  }
}

/** The version of the `@astrale-os/sdk` the Domain at `root` resolves, or null without one. */
export function installedSdkVersion(root: string): string | null {
  const manifest = nearest(root, join('@astrale-os', 'sdk', 'package.json'))
  if (manifest === null) return null
  try {
    return asString(asJsonRecord(parseJson(readFileSync(manifest, 'utf8')))?.version) ?? null
  } catch {
    return null
  }
}

/** The `astrale-domain` executable the Domain's package manager linked, or null without one. */
export function astraleDomainCommand(root: string): string | null {
  return nearest(root, join('.bin', 'astrale-domain'))
}
