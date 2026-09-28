import { join } from 'node:path'

import type { AdminConnectionOptions } from '../connection'
import type { OutputOpts } from '../lib/output'
import type { CommandDefinition } from '../program'

import pkg from '../../package.json' with { type: 'json' }
import { createPathCall, withAdminClientSession } from '../connection'
import { AstraleError } from '../errors'
import { collectIssueContext } from '../issues/context'
import {
  ISSUE_REPORT_PATH,
  issueContentSchema,
  submitIssue,
  type IssueContent,
} from '../issues/submit'
import { ADMIN_TARGET_OPTIONS } from '../lib/admin-target'
import { readInstances } from '../lib/instance'
import { fatal, log } from '../lib/log'
import { isMachine, output } from '../lib/output'
import { withKernelOptions } from '../program/options'
import { ASTRALE_HOME } from '../state'

export type IssueOptions = AdminConnectionOptions &
  OutputOpts & {
    body?: string
    project?: string
    retry?: string
    debug?: boolean
  }

const defaults = {
  withAdminClientSession,
  collectIssueContext,
  readInstances,
  submitIssue,
  readBody: readBodyFromStdin,
  cwd: () => process.cwd(),
  directory: () => join(ASTRALE_HOME, 'issues', 'pending'),
}

export async function reportIssueCommand(
  title: string | undefined,
  options: IssueOptions,
  dependencies = defaults,
) {
  if (
    options.retry !== undefined &&
    (title !== undefined ||
      options.body !== undefined ||
      options.project !== undefined ||
      options.instance !== undefined)
  )
    throw new AstraleError(
      'ISSUE_RETRY_INVALID',
      '--retry reuses the saved title, body, project and affected instance.',
    )
  let content: IssueContent | undefined
  if (options.retry === undefined) {
    const body = options.body ?? (await dependencies.readBody())
    const text = issueContentSchema.safeParse({ title, body })
    if (!text.success)
      throw new AstraleError(
        'ISSUE_INPUT_INVALID',
        'Provide a title (1–200 characters) and a body (1–50,000 characters).',
        'Use --body "Context and reproduction", or pipe the body on stdin.',
      )
    const context = await dependencies.collectIssueContext({
      cwd: dependencies.cwd(),
      project: options.project,
      instance: options.instance,
      cliVersion: pkg.version,
      ...(options.instance === undefined ? {} : { instances: await dependencies.readInstances() }),
    })
    content = issueContentSchema.parse({ ...text.data, context })
  }
  // The affected bookmark is evidence only. It must never enter Admin destination resolution.
  const { instance: _affected, project: _project, body: _body, retry, ...adminOptions } = options
  return dependencies.withAdminClientSession(adminOptions, async (connection) => {
    const principal = (await connection.self()).id
    if (connection.target.domainIssuer === undefined)
      throw new AstraleError(
        'ADMIN_DOMAIN_ISSUER_MISSING',
        'The selected Admin has no Domain issuer.',
      )
    return dependencies.submitIssue({
      content,
      retry,
      directory: dependencies.directory(),
      scope: {
        principal,
        kernelIssuer: connection.target.kernelIssuer,
        domainIssuer: connection.target.domainIssuer,
      },
      send: (payload) => connection.session.call(createPathCall(ISSUE_REPORT_PATH, payload)),
      warn: log.warn,
    })
  })
}

async function readBodyFromStdin(): Promise<string | undefined> {
  if (process.stdin.isTTY) return undefined
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of process.stdin) {
    const buffer = Buffer.from(chunk)
    size += buffer.byteLength
    if (size > 200_000)
      throw new AstraleError('ISSUE_INPUT_INVALID', 'The issue body is too large.')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

const command = withKernelOptions({
  name: 'issue',
  description: 'Report a problem to Admin with automatic local context',
  arguments: [
    { name: 'title', description: 'Short factual title (omit only with --retry)', required: false },
  ],
  options: [
    ...ADMIN_TARGET_OPTIONS,
    { flags: '--body <text>', description: 'Context and reproduction; otherwise read stdin' },
    {
      flags: '--project <directory>',
      description: 'Project package whose installed versions to observe',
    },
    {
      flags: '--retry <request-id>',
      description: 'Resume an unconfirmed report with its original context',
    },
  ],
  afterHelpText: `
  A title and body are enough. Prefer --project and -i when known.
  Suggested body: Context, Reproduction (exact command or input, steps,
  expected vs. actual result), Impact. Keep it brief.
  If confirmation fails, use the printed --retry command.

  $ astrale issue "Short title" --body "Context and reproduction"
  $ cat reproduction.md | astrale issue "Short title" --project ./orders -i staging
`,
  action: async (title: string | undefined, options: IssueOptions) => {
    try {
      const receipt = await reportIssueCommand(title, options)
      if (isMachine(options) || options.format !== undefined) output(receipt, options)
      else log.success(`Reported: ${receipt.reference}`)
    } catch (cause) {
      fatal(cause, options)
    }
  },
} satisfies CommandDefinition)

export default {
  ...command,
  options: command.options
    ?.filter((option) => !['--url <url>', '--anonymous'].includes(option.flags))
    .map((option) =>
      option.flags === '-i, --instance <name>'
        ? { ...option, description: 'Affected instance bookmark (optional; never the destination)' }
        : option,
    ),
} satisfies CommandDefinition
