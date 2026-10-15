import type { Binary } from '@astrale-os/sdk/client'

import { Path } from '@astrale-os/sdk/graph/path'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { open, rename, rm } from 'node:fs/promises'

import type { KernelCommandOpts } from '../connection'
import type { CommandDefinition } from '../program/index'

import { expandSelfInPath, runKernelCommand, withSelfHint } from '../connection'
import { AstraleError } from '../errors'
import { failInput, fatal, log } from '../lib/terminal/log'
import { isMachine, output } from '../lib/terminal/output'

type DownloadOpts = KernelCommandOpts & { output?: string }

/** What a blob Property holds and a read shows: the Kernel's artifact Ref, never the bytes. */
interface StoredFile {
  readonly digest: string
  readonly mediaType: string
  readonly size: number
}

/** One file, by the Node and Property holding it. */
interface HeldFile extends StoredFile {
  /** Node id, without `@`. */
  readonly node: string
  /** Property key, `origin:class.Name.property.name`. */
  readonly property: string
}

interface Downloaded {
  readonly node: string
  readonly property: string
  readonly mediaType: string
  readonly size: number
  readonly digest: string
  /** The file written, or `-` for stdout. */
  readonly file: string
}

/** The byte sink of a download: a file written whole or not at all, or stdout. */
interface Sink {
  write(chunk: Uint8Array): Promise<void>
  /** Keep what was written; called once every byte arrived and verified. */
  commit(): Promise<void>
  /** Discard what was written. */
  abort(): Promise<void>
}

/** Stream the file a Node holds in a blob Property to a file or stdout, verified by its digest. */
export async function downloadCommand(
  node: string,
  property: string,
  opts: DownloadOpts,
): Promise<void> {
  let parsed: Path
  try {
    parsed = Path.parse(nodeTarget(node))
  } catch (error) {
    failInput(error, opts)
  }
  if (parsed.ast.steps.at(-1)?.kind === 'method') {
    fatal(
      new AstraleError(
        'NOT_A_NODE',
        `${node} is a callable Path, not a Node.`,
        `Use \`astrale call ${node}\` for a callable's binary output.`,
      ),
      opts,
    )
  }
  const toStdout = opts.output === '-' || (opts.output === undefined && !isTerminal())
  if (opts.output === undefined && !toStdout) {
    fatal(
      new AstraleError(
        'OUTPUT_REQUIRED',
        'A file is not printed to a terminal.',
        'Write it with -o <file>, or redirect stdout.',
      ),
      opts,
    )
  }
  if (toStdout && (opts.json === true || opts.raw === true)) {
    fatal(
      new AstraleError(
        'OUTPUT_CONFLICT',
        'The file and its JSON description cannot share stdout.',
        'Write the file with -o <file> to get its description with --json.',
      ),
      opts,
    )
  }

  await runKernelCommand({
    opts,
    label: `File ${property} of ${node}`,
    // A graph read: the file is served as what `astrale get` reads.
    credential: { principal: 'caller' },
    fn: async (context): Promise<Downloaded> => {
      const { path, meta } = await expandSelfInPath(parsed.toString(), context)
      return withSelfHint(async () => {
        const holder = await context.graph.getOrThrow(
          meta === undefined ? parsed : Path.parse(path),
        )
        const file = heldFile(holder as ReadNode, property)
        const binary = await context.session.content.download({
          node: file.node,
          property: file.property,
        })
        const sink = toStdout ? stdoutSink() : await fileSink(opts.output!)
        await transfer(binary, file, sink)
        return { ...describe(file), file: toStdout ? '-' : opts.output! }
      }, meta)
    },
    format: (downloaded, format) => {
      if (downloaded.file === '-') return
      if (isMachine(format)) {
        output(downloaded, format)
        return
      }
      log.success(
        `Saved ${downloaded.file} (${downloaded.mediaType}, ${humanSize(downloaded.size)})`,
      )
    },
  })
}

/** A bare Node id is read as `@id`; a Path or `@id` as is. */
function nodeTarget(target: string): string {
  return target.startsWith('/') || target.startsWith('@') ? target : `@${target}`
}

interface ReadNode {
  readonly id: string
  readonly props: Readonly<Record<string, unknown>>
}

/** The file `node` holds in `property`, a Property key or its name. */
export function heldFile(node: ReadNode, property: string): HeldFile {
  const files = Object.entries(node.props).filter(([, value]) => isStoredFile(value))
  const named = property.includes(':')
    ? files.filter(([key]) => key === property)
    : files.filter(([key]) => key.endsWith(`.property.${property}`))
  const id = node.id.replace(/^@/u, '')
  if (named.length === 1) {
    const [[key, { digest, mediaType, size }]] = named as [[string, StoredFile]]
    return { node: id, property: key, digest, mediaType, size }
  }
  if (named.length > 1) {
    throw new AstraleError(
      'AMBIGUOUS_FILE_PROPERTY',
      `@${id} holds several files named ${property}.`,
      `Name one by its key: ${named.map(([key]) => key).join(', ')}`,
    )
  }
  const held = files.map(([key]) => key)
  throw new AstraleError(
    'FILE_NOT_FOUND',
    `@${id} holds no file in ${property} that you can read.`,
    held.length === 0
      ? 'This Node holds no file you can read.'
      : `Files it holds: ${held.join(', ')}`,
  )
}

function isStoredFile(value: unknown): value is StoredFile {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const { digest, mediaType, size } = value as Record<string, unknown>
  return (
    typeof digest === 'string' &&
    digest.startsWith('sha256:') &&
    typeof mediaType === 'string' &&
    typeof size === 'number'
  )
}

/** Stream every byte to `sink`, then keep it only if it is exactly the file the Node holds. */
async function transfer(binary: Binary, file: HeldFile, sink: Sink): Promise<void> {
  const hash = createHash('sha256')
  let size = 0
  try {
    for await (const chunk of binary.body instanceof Uint8Array ? [binary.body] : binary.body) {
      hash.update(chunk)
      size += chunk.byteLength
      await sink.write(chunk)
    }
    const digest = `sha256:${hash.digest('hex')}`
    if (size !== file.size || digest !== file.digest) {
      throw new AstraleError(
        'FILE_INTEGRITY',
        `The bytes received (${size} B, ${digest}) are not the file the Node holds (${file.size} B, ${file.digest}).`,
        'Retry the download; the file may have changed meanwhile.',
      )
    }
    await sink.commit()
  } catch (error) {
    await sink.abort()
    throw error
  }
}

/** Writes beside `path` and renames once complete, so `path` never holds a partial file. */
async function fileSink(path: string): Promise<Sink> {
  const partial = `${path}.part`
  const handle = await open(partial, 'w')
  let closed = false
  const close = async () => {
    if (closed) return
    closed = true
    await handle.close()
  }
  return {
    async write(chunk) {
      await handle.write(chunk)
    },
    async commit() {
      await close()
      await rename(partial, path)
    },
    async abort() {
      await close().catch(() => {})
      await rm(partial, { force: true })
    },
  }
}

function stdoutSink(): Sink {
  return {
    async write(chunk) {
      if (!process.stdout.write(chunk)) await once(process.stdout, 'drain')
    },
    commit: async () => {},
    abort: async () => {},
  }
}

function isTerminal(): boolean {
  return process.stdout.isTTY ?? false
}

function describe(file: HeldFile) {
  return {
    node: `@${file.node}`,
    property: file.property,
    mediaType: file.mediaType,
    size: file.size,
    digest: file.digest,
  }
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['kB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(1)} ${units[unit]}`
}

export default {
  name: 'download',
  description: 'Download the file a node holds in a blob property',
  afterHelpText: `
Behavior:
  Reads the node, finds the file its property holds (a read shows it as
  { digest, mediaType, size }), then streams the bytes, checked against
  that size and digest. A file is written to <file>.part and renamed when
  complete, so <file> never holds a partial download.

  <property> is a property key (origin:class.Name.property.name) or its
  name when the node holds one file by that name. Missing and unreadable
  files are indistinguishable. Without -o, the bytes go to a redirected
  stdout; a terminal is refused.

Examples:
  $ astrale download @abc123 document -o balance.csv
  $ astrale download @abc123 sextant.so:class.TrialBalance.property.document -o balance.csv --json
  $ astrale download @abc123 document > balance.csv
`,
  arguments: [
    { name: 'node', description: 'Node Path or @id holding the file' },
    { name: 'property', description: 'Blob property key or name' },
  ],
  options: [{ flags: '-o, --output <file>', description: 'Write the file here (- for stdout)' }],
  action: async (node, property, opts) => {
    await downloadCommand(node as string, property as string, opts as DownloadOpts)
  },
} satisfies CommandDefinition
