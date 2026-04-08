import chalk from 'chalk'

import type { KernelCommandOpts } from '../kernel'

import { withKernelClient, formatKernelError } from '../kernel'
import { spinner } from '../lib/log'
import { isRawOutput, output } from '../lib/output'

type LsOpts = KernelCommandOpts & { long?: boolean }

type Item = {
  id?: string
  slug?: string
  class?: string
  __labels?: string[]
}

export async function lsCommand(path: string, opts: LsOpts): Promise<void> {
  const isRaw = isRawOutput(opts)
  const spin = !isRaw ? spinner(`Listing ${path}...`) : null
  const method = `${path}:listChildren`

  try {
    const result = await withKernelClient(opts, (ctx) =>
      ctx.client.call(method, {}, ctx.credential),
    )

    const items: Item[] = Array.isArray(result)
      ? (result as Item[])
      : ((result as { items?: Item[] })?.items ?? [])
    spin?.succeed(`Children of ${path} (${items.length})`)
    if (!isRaw) console.log('')

    // Compact view only when the user hasn't asked for the full dump
    // (--long, --raw, --json, --format ...) or when we're piped.
    if (isRaw || opts.long || opts.format) {
      output(result, opts)
    } else {
      printCompact(items)
    }
    process.exit(0)
  } catch (error) {
    if (!isRaw && spin) spin.fail('Failed')
    formatKernelError(error, isRaw, undefined, opts.debug)
    process.exit(1)
  }
}

/** Compact one-line-per-child view: `slug   class   id`. */
function printCompact(items: Item[]): void {
  if (items.length === 0) {
    console.log(chalk.dim('  (empty)'))
    return
  }
  const slugW = Math.max(4, ...items.map((i) => (i.slug ?? '').length))
  for (const item of items) {
    const slug = (item.slug ?? '').padEnd(slugW)
    const cls = chalk.dim(shortClass(item))
    const id = chalk.dim(item.id ?? '')
    console.log(`  ${chalk.cyan(slug)}  ${cls}  ${id}`)
  }
}

function shortClass(item: Item): string {
  if (item.class) {
    const last = item.class.split('/').pop()
    if (last) return last
  }
  return item.__labels?.[item.__labels.length - 1] ?? '?'
}
