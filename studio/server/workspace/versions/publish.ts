/**
 * Publish one workspace Domain to one of its Environments: the platform's own
 * `astrale-domain publish <environment> --json`, run in the Domain's root with its installed SDK.
 * The platform deploys or reuses the release, verifies it and tags it; the Studio only guards the
 * start and relays what the platform composed.
 *
 * Nothing runs unless every guard holds, in order: a well-formed request, a Studio started with
 * publishing on, no Publish of this Domain
 * already running, a look of this Domain's change report no older than `LOOK_TTL_MS`, sources still
 * at the look's version and revision, a look the platform accepted (or a version it already
 * published), an Environment the Project declares, and the platform's tooling installed. The look
 * is spent by the Publish it starts.
 *
 * The run is never cancelled by a closed stream: a Publish stopped half-way would leave a
 * deployment without its Publication.
 */
import type {
  PublishEvent,
  PublishRefusal,
  PublishReport,
} from '../../../shared/contracts/versions'
import type { DomainHandle } from '../../domain/registry'
import type { ChangeJudge } from './changes'
import type { VersionsContext } from './context'
import type { RegistryReader } from './registry'

import { analyzeProjectConfig } from '../../domain/registry'
import { asBoolean, asJsonRecord, asString, parseJson } from '../../json'
import { LOOK_TTL_MS } from './changes'
import { readSources } from './local'
import { MarkedLineReader } from './marks'
import { astraleDomainCommand } from './sdk'

const PUBLISH_TIMEOUT_MS = 15 * 60_000
/** An Environment name as the Project declares it; never a flag. */
const ENVIRONMENT = /^[a-z0-9][a-z0-9._-]*$/i

export type PublishStart =
  | { ok: false; status: number; refusal: PublishRefusal }
  | { ok: true; events: ReadableStream<Uint8Array> }

export interface Publisher {
  start(handle: DomainHandle, request: unknown): Promise<PublishStart>
  /** The Domains a Publish is running for. */
  running(): string[]
}

export function createPublisher(
  context: VersionsContext,
  registry: RegistryReader,
  changes: ChangeJudge,
): Publisher {
  const running = new Set<string>()

  const refuse = (
    status: number,
    error: PublishRefusal['error'],
    message: string,
  ): PublishStart => ({
    ok: false,
    status,
    refusal: { error, message },
  })

  async function start(handle: DomainHandle, input: unknown): Promise<PublishStart> {
    const body = asJsonRecord(input)
    const environment = asString(body?.environment)
    const lookId = asString(body?.look)
    const allowDirty = body?.allowDirty === undefined ? false : asBoolean(body.allowDirty)
    if (environment === undefined || !ENVIRONMENT.test(environment)) {
      return refuse(400, 'invalid-request', 'Name the Environment to publish to.')
    }
    if (lookId === undefined) {
      return refuse(400, 'invalid-request', 'Publish requires the look of a fresh change report.')
    }
    if (allowDirty === undefined)
      return refuse(400, 'invalid-request', '`allowDirty` is a boolean.')
    if (!context.publishing()) {
      return refuse(409, 'publish-disabled', 'This Studio was started with publishing off.')
    }
    if (running.has(handle.id)) {
      return refuse(409, 'publish-running', 'A Publish of this Domain is already running.')
    }

    const look = changes.look(lookId)
    if (look === undefined || look.domainId !== handle.id) {
      return refuse(
        409,
        'look-missing',
        'No change report of this Domain has that look: look again.',
      )
    }
    if (context.now() - look.takenAt >= LOOK_TTL_MS) {
      return refuse(409, 'look-stale', 'The change report is too old to publish from: look again.')
    }
    const sources = await readSources(context, handle)
    if (sources.declared !== look.declared || sources.revision !== look.revision) {
      return refuse(409, 'look-stale', 'The sources changed since the change report: look again.')
    }
    if (!look.accepted && !look.published) {
      return refuse(
        409,
        'look-refused',
        `The platform does not accept ${look.declared} for these changes: raise the version.`,
      )
    }
    const declared = analyzeProjectConfig(handle.root).environments
    if (!declared.declared) {
      return refuse(409, 'environment-unknown', 'The Project declares no Environments.')
    }
    if (declared.complete && !declared.environments.some((entry) => entry.name === environment)) {
      return refuse(
        409,
        'environment-unknown',
        `The Project declares no Environment ${environment}.`,
      )
    }
    const command = astraleDomainCommand(handle.root)
    if (command === null) {
      return refuse(
        409,
        'tooling-missing',
        'astrale-domain is not installed for this Domain: install its dependencies.',
      )
    }
    // Re-checked after the awaits above: two requests may have passed the first checks together.
    if (running.has(handle.id)) {
      return refuse(409, 'publish-running', 'A Publish of this Domain is already running.')
    }
    if (changes.look(look.id) === undefined) {
      return refuse(409, 'look-missing', 'That look was spent by another Publish: look again.')
    }

    changes.spend(look.id)
    running.add(handle.id)
    const argv = [
      command,
      'publish',
      environment,
      '--json',
      ...(allowDirty ? ['--allow-dirty'] : []),
    ]
    const origin = sources.origin
    const encoder = new TextEncoder()
    let open = true
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const events = new ReadableStream<Uint8Array>({
      start(stream) {
        controller = stream
      },
      cancel() {
        open = false
      },
    })
    const send = (event: PublishEvent) => {
      if (!open) return
      try {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
      } catch {
        open = false
      }
    }

    send({ type: 'started', domainId: handle.id, environment, look: look.id, command: argv })
    const refusals: string[] = []
    const reader = new MarkedLineReader(({ tone, line, continues }) => {
      send({ type: 'progress', tone, line })
      if (tone !== 'refusal') return
      if (continues && refusals.length > 0) refusals[refusals.length - 1] += `\n${line}`
      else refusals.push(line)
    })
    void context
      .run(argv, {
        cwd: handle.root,
        timeoutMs: PUBLISH_TIMEOUT_MS,
        onStderr: (chunk) => reader.push(chunk),
      })
      .then((run) => {
        reader.end()
        const report =
          run.exitCode === 0 ? decodePublishReport(parseJson(run.stdout.trim())) : undefined
        if (report) {
          send({ type: 'result', ok: true, report, unrelayedLines: reader.unmarked })
          return
        }
        const message =
          run.spawnError !== undefined
            ? `astrale-domain publish could not start: ${run.spawnError}`
            : run.timedOut
              ? `astrale-domain publish gave no answer in ${PUBLISH_TIMEOUT_MS / 60_000} min and was stopped.`
              : refusals.length > 0
                ? refusals.join('\n')
                : run.exitCode === 0
                  ? 'astrale-domain publish answered no report this Studio can read.'
                  : `astrale-domain publish failed (exit ${run.exitCode}).`
        send({
          type: 'result',
          ok: false,
          message,
          exitCode: run.exitCode,
          unrelayedLines: reader.unmarked,
        })
      })
      .catch((error: unknown) => {
        send({
          type: 'result',
          ok: false,
          message: `astrale-domain publish could not run: ${error instanceof Error ? error.message : String(error)}`,
          exitCode: -1,
          unrelayedLines: reader.unmarked,
        })
      })
      .finally(() => {
        running.delete(handle.id)
        if (origin !== null) registry.forget(origin)
        changes.forget(handle.id)
        if (open) {
          open = false
          controller.close()
        }
      })
    return { ok: true, events }
  }

  return { start, running: () => [...running] }
}

/** `PublishReportV1`, whole or not at all. */
export function decodePublishReport(value: unknown): PublishReport | undefined {
  const document = asJsonRecord(value)
  const publication = asJsonRecord(document?.publication)
  const origin = asString(document?.origin)
  const environment = asString(document?.environment)
  const version = asString(publication?.version)
  const url = asString(document?.url)
  const releaseDigest = asString(document?.releaseDigest)
  const buildDigest = asString(document?.buildDigest)
  const status = publication?.status
  const deployment = document?.deployment
  if (
    document?.format !== 'astrale.publish-report' ||
    document.version !== 1 ||
    origin === undefined ||
    environment === undefined ||
    version === undefined ||
    (status !== 'created' && status !== 'unchanged') ||
    (deployment !== 'created' && deployment !== 'reused' && deployment !== 'none') ||
    url === undefined ||
    releaseDigest === undefined ||
    buildDigest === undefined
  ) {
    return undefined
  }
  let commit: PublishReport['commit'] = null
  if (document.commit !== null) {
    const record = asJsonRecord(document.commit)
    const sha = asString(record?.sha)
    const dirty = asBoolean(record?.dirty)
    const base = record?.base
    if (
      sha === undefined ||
      dirty === undefined ||
      (base !== undefined && typeof base !== 'string')
    ) {
      return undefined
    }
    commit = { sha, dirty, ...(base === undefined ? {} : { base }) }
  }
  return {
    origin,
    environment,
    publication: { version, status },
    deployment,
    url,
    releaseDigest,
    buildDigest,
    commit,
  }
}
