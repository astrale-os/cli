import { join } from 'node:path'

import type { AdminConnectionOptions } from '../../connection'
import type { OutputOpts } from '../../lib/terminal/output'
import type { CommandDefinition } from '../../program'

import pkg from '../../../package.json' with { type: 'json' }
import { createPathCall, withAdminClientSession } from '../../connection'
import { AstraleError } from '../../errors'
import { collectIssueContext } from '../../issues/context'
import {
  admitIssueText,
  ISSUE_BODY,
  ISSUE_REPORT_PATH,
  ISSUE_TITLE,
  issueContentSchema,
  submitIssue,
  type IssueContent,
} from '../../issues/submit'
import { readInstances } from '../../lib/instance/bookmarks'
import { log } from '../../lib/terminal/log'
import { isMachine, output } from '../../lib/terminal/output'
import { ASTRALE_HOME } from '../../state'
import { failIssueCommand } from './failure'
import { withIssueAdminOptions } from './options'

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
    admitIssueText('The title', title ?? '', ISSUE_TITLE, TITLE_HINT)
    admitIssueText('The body', body ?? '', ISSUE_BODY, BODY_HINT)
    const context = await dependencies.collectIssueContext({
      cwd: dependencies.cwd(),
      project: options.project,
      instance: options.instance,
      cliVersion: pkg.version,
      ...(options.instance === undefined ? {} : { instances: await dependencies.readInstances() }),
    })
    content = issueContentSchema.parse({ title, body, context })
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

const TITLE_HINT = 'Title the observed fact: astrale issue "Short title" --body "Details"'
const BODY_HINT = 'Use --body "Context and details", or pipe the body on stdin.'
/** Bounds stdin before decoding: 50,000 characters take at most 200,000 UTF-8 bytes. */
const MAXIMUM_STDIN_BYTES = 200_000

async function readBodyFromStdin(): Promise<string | undefined> {
  if (process.stdin.isTTY) return undefined
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of process.stdin) {
    const buffer = Buffer.from(chunk)
    size += buffer.byteLength
    if (size > MAXIMUM_STDIN_BYTES)
      throw new AstraleError(
        'ISSUE_INPUT_INVALID',
        `The body on stdin has more than ${MAXIMUM_STDIN_BYTES.toLocaleString('en-US')} bytes; the limit is ${ISSUE_BODY.maximum.toLocaleString('en-US')} characters.`,
        BODY_HINT,
      )
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

export default withIssueAdminOptions(
  {
    name: 'report',
    description: 'Report a bug, limitation, or friction to Admin (default)',
    arguments: [
      {
        name: 'title',
        description: `Short factual title, at most ${ISSUE_TITLE.maximum} characters (omit only with --retry)`,
        required: false,
      },
    ],
    options: [
      { flags: '--body <text>', description: 'Issue details; otherwise read stdin' },
      {
        flags: '--project <directory>',
        description: 'Project package whose installed versions to observe',
      },
      {
        flags: '--retry <request-id>',
        description: 'Resend a report whose outcome is unknown, with its original context',
      },
    ],
    afterHelpText: `
  A title and body are enough. Prefer --project and -i when known.
  Body, one field per line: Type (bug, limitation, or friction), Context,
  Scenario (numbered steps), Observed, Expected, Impact, Workaround, Evidence.
  If Admin's answer is lost, the request is saved: run the printed --retry
  command. A refusal prints its code and failing input; nothing is saved.

  $ astrale issue "Short title" --body "Context and details"
  $ cat issue.md | astrale issue report "Short title" --project ./orders -i staging
`,
    action: async (title: string | undefined, options: IssueOptions) => {
      try {
        const receipt = await reportIssueCommand(title, options)
        if (isMachine(options) || options.format !== undefined) output(receipt, options)
        else log.success(`Reported: ${receipt.reference}`)
      } catch (cause) {
        await failIssueCommand(cause, options)
      }
    },
  } satisfies CommandDefinition,
  { affectedInstance: true },
)
