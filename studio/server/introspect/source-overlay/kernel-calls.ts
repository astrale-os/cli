/**
 * Kernel-operation token scan for resolved handler source files.
 */
import { readFileSync } from 'node:fs'

/** Kernel-op idioms surfaced as `kernelCalls`; entries are longest-first. */
const KERNEL_TOKENS = [
  'graph.createEdge',
  'graph.removeEdge',
  'function.mutate',
  'graph.children',
  'function.get',
  'graph.create',
  'graph.update',
  'graph.remove',
  'graph.mutate',
  'auth.revoke',
  'graph.links',
  'auth.grant',
  'auth.check',
  'graph.tree',
  'graph.node',
  'graph.get',
] as const

/** Scan handler file text for kernel-op tokens. */
export function scanKernelCalls(file: string): string[] {
  let work: string
  try {
    work = readFileSync(file, 'utf8')
  } catch {
    return []
  }
  const found: string[] = []
  for (const token of KERNEL_TOKENS) {
    if (!work.includes(token)) continue
    found.push(token)
    // Blank out matches so `graph.createEdge` doesn't also count as `graph.create`.
    work = work.replaceAll(token, ' '.repeat(token.length))
  }
  return found
}
