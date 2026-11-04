import type { KernelCommandOpts } from '../connection'
import type { CommandDefinition } from '../program/index'

import { runKernelCommand } from '../connection'
import { failInput, log } from '../lib/terminal/log'
import { isMachine, output } from '../lib/terminal/output'
import { formatBytes, localFile, uploadFile, type Uploaded } from '../lib/upload'

type UploadOpts = KernelCommandOpts & { mediaType?: string }

interface UploadDependencies {
  readonly runKernelCommand: typeof runKernelCommand
}

const dependencies: UploadDependencies = { runKernelCommand }

/** Stream a file to the Kernel and print the receipt that attaches it or passes it to a callable. */
export async function uploadCommand(
  path: string,
  opts: UploadOpts,
  adapters: UploadDependencies = dependencies,
): Promise<void> {
  let file
  try {
    file = await localFile(path, opts.mediaType)
  } catch (error) {
    failInput(error, opts)
  }

  await adapters.runKernelCommand<Uploaded>({
    opts,
    label: `Upload ${path}`,
    // The receipt names the user who uploads it; until it expires it serves whoever presents it:
    // `mutate`, or the Domain callable the user passes it to.
    credential: { principal: 'caller' },
    fn: ({ session }) => uploadFile(session, file),
    format: (uploaded, format) => {
      if (format.raw === true) {
        process.stdout.write(`${uploaded.receipt}\n`)
        return
      }
      if (isMachine(format) || format.format !== undefined) {
        output(uploaded, format)
        return
      }
      log.success(
        `Uploaded ${uploaded.file} (${uploaded.mediaType}, ${formatBytes(uploaded.size)})`,
      )
      log.dim(`  digest   ${uploaded.digest}`)
      log.dim(`  expires  ${uploaded.expiresAt}`)
      console.log('')
      console.log(uploaded.receipt)
    },
  })
}

export default {
  name: 'upload',
  description: 'Upload a file and print the receipt that attaches it',
  afterHelpText: `
Behavior:
  Streams the file from disk to the Kernel (at most 100 MiB) and prints its
  receipt, digest, media type, size and expiry. Nothing is attached yet: the
  receipt is what a blob property accepts in \`astrale mutate\`, and what a
  Domain callable's file field receives in \`astrale call\`.

  A receipt works on this instance only, for whoever presents it, until
  expiresAt (15 minutes after the upload): keep it private, upload just before
  using it, or let \`astrale call --file\` upload and call in one step. Without
  --media-type, the type follows the file extension (application/octet-stream
  when unknown). --json prints { receipt, digest, mediaType, size, expiresAt,
  file }; --raw prints the receipt alone.

Examples:
  $ astrale upload ./balance.csv
  $ RECEIPT=$(astrale upload ./report.pdf --raw)
  $ astrale upload ./scan.bin --media-type image/png --json
  $ astrale call /:sextant.so:class.TrialBalance:import --file balance=./balance.csv
`,
  arguments: [{ name: 'file', description: 'Path of the file to upload' }],
  options: [
    {
      flags: '--media-type <type>',
      description: 'Media type to declare (default: from the file extension)',
    },
  ],
  action: async (path, opts) => {
    await uploadCommand(path as string, opts as UploadOpts)
  },
} satisfies CommandDefinition
