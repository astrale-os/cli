/**
 * Publish, as a state machine the dialog only draws.
 *
 * A Publish starts from a fresh look: the platform's change report taken now, at the sources it
 * publishes. The reader then chooses an Environment, reads exactly what will be published, and
 * confirms by typing the version. The Studio server refuses before anything runs when a guard
 * fails; once it runs, every line the platform marks is relayed, then the final report or the
 * platform's own refusal.
 *
 * The machine is pure (`publishReducer`), the run is a driver over any `publish` stream
 * (`runPublish`), and each Domain's run lives in a store, so closing the dialog never loses a run.
 */

import type {
  ChangeReport,
  DomainLocal,
  PublicationRelation,
  PublishEvent,
  PublishRefusal,
  PublishReport,
  PublishRequest,
  Remote,
  RemoteFailure,
} from '@shared/contracts/versions'

import { create } from 'zustand'

import { failureWords, nextVersion } from './words'

// ─── State ───────────────────────────────────────────────────────────────────

export interface ProgressLine {
  tone: 'step' | 'warning' | 'refusal'
  line: string
}

type Started = Extract<PublishEvent, { type: 'started' }>

export type PublishState =
  | { phase: 'idle' }
  /** Taking a fresh look: the platform's change report at the sources as they are now. */
  | { phase: 'looking' }
  /** No change report: the registry or the platform could not answer. */
  | { phase: 'look-failed'; failure: Pick<RemoteFailure, 'status' | 'message' | 'code'> }
  /** The look is taken: the reader chooses and confirms. */
  | { phase: 'review'; report: ChangeReport }
  /** Asked the Studio server to start; nothing has run yet. */
  | { phase: 'starting'; report: ChangeReport; request: PublishRequest }
  | {
      phase: 'running'
      report: ChangeReport
      request: PublishRequest
      started?: Started
      lines: ProgressLine[]
    }
  | {
      phase: 'published'
      report: ChangeReport
      request: PublishRequest
      started?: Started
      lines: ProgressLine[]
      result: PublishReport
      unrelayedLines: number
    }
  /** The platform ran and refused, or failed. */
  | {
      phase: 'failed'
      report: ChangeReport
      request: PublishRequest
      started?: Started
      lines: ProgressLine[]
      message: string
      exitCode: number
      unrelayedLines: number
    }
  /** The Studio server refused before anything ran. */
  | { phase: 'refused'; report: ChangeReport; request: PublishRequest; refusal: PublishRefusal }
  /** The stream broke: whether the platform finished is not known. */
  | {
      phase: 'error'
      report: ChangeReport
      request: PublishRequest
      lines: ProgressLine[]
      message: string
    }

export type PublishAction =
  | { type: 'look' }
  | { type: 'looked'; answer: Remote<ChangeReport> }
  | { type: 'look-errored'; message: string }
  | { type: 'start'; request: PublishRequest }
  | { type: 'event'; event: PublishEvent }
  | { type: 'refused'; refusal: PublishRefusal }
  | { type: 'errored'; message: string }
  /** Back from a refusal to the same look, to choose again. */
  | { type: 'revise' }
  | { type: 'reset' }

export const IDLE_PUBLISH: PublishState = { phase: 'idle' }

/** Whether a run is under way: the dialog may close, the run goes on. */
export function isRunning(state: PublishState): boolean {
  return state.phase === 'starting' || state.phase === 'running'
}

function linesOf(state: PublishState): ProgressLine[] {
  return 'lines' in state ? state.lines : []
}

function startedOf(state: PublishState): Started | undefined {
  return 'started' in state ? state.started : undefined
}

export function publishReducer(state: PublishState, action: PublishAction): PublishState {
  switch (action.type) {
    case 'reset':
      return isRunning(state) ? state : IDLE_PUBLISH
    case 'look':
      return isRunning(state) ? state : { phase: 'looking' }
    case 'looked':
      if (state.phase !== 'looking') return state
      return action.answer.status === 'ok'
        ? { phase: 'review', report: action.answer.value }
        : { phase: 'look-failed', failure: action.answer }
    case 'look-errored':
      if (state.phase !== 'looking') return state
      return { phase: 'look-failed', failure: { status: 'failed', message: action.message } }
    case 'start':
      if (state.phase !== 'review' && state.phase !== 'refused') return state
      return { phase: 'starting', report: state.report, request: action.request }
    case 'event': {
      if (state.phase !== 'starting' && state.phase !== 'running') return state
      const base = { report: state.report, request: state.request }
      const event = action.event
      if (event.type === 'started')
        return { phase: 'running', ...base, started: event, lines: linesOf(state) }
      if (event.type === 'progress')
        return {
          phase: 'running',
          ...base,
          started: startedOf(state),
          lines: [...linesOf(state), { tone: event.tone, line: event.line }],
        }
      return event.ok
        ? {
            phase: 'published',
            ...base,
            started: startedOf(state),
            lines: linesOf(state),
            result: event.report,
            unrelayedLines: event.unrelayedLines,
          }
        : {
            phase: 'failed',
            ...base,
            started: startedOf(state),
            lines: linesOf(state),
            message: event.message,
            exitCode: event.exitCode,
            unrelayedLines: event.unrelayedLines,
          }
    }
    case 'revise':
      return state.phase === 'refused' ? { phase: 'review', report: state.report } : state
    case 'refused':
      if (state.phase !== 'starting') return state
      return {
        phase: 'refused',
        report: state.report,
        request: state.request,
        refusal: action.refusal,
      }
    case 'errored':
      if (state.phase !== 'starting' && state.phase !== 'running') return state
      return {
        phase: 'error',
        report: state.report,
        request: state.request,
        lines: linesOf(state),
        message: action.message,
      }
  }
}

// ─── Driver ──────────────────────────────────────────────────────────────────

export type PublishStream = (
  domainId: string,
  request: PublishRequest,
  onEvent: (event: PublishEvent) => void,
) => Promise<{ refused: PublishRefusal } | { result: Extract<PublishEvent, { type: 'result' }> }>

const REFUSALS = new Set<PublishRefusal['error']>([
  'publish-disabled',
  'look-missing',
  'look-stale',
  'look-refused',
  'environment-unknown',
  'publish-running',
  'tooling-missing',
  'invalid-request',
])

function isRefusal(value: unknown): value is PublishRefusal {
  const record = value as { error?: unknown; message?: unknown } | null
  return (
    typeof record === 'object' &&
    record !== null &&
    REFUSALS.has(record.error as PublishRefusal['error']) &&
    typeof record.message === 'string'
  )
}

/** Takes a fresh look through `look`, then hands the answer to the machine. */
export async function takeLook(
  look: () => Promise<Remote<ChangeReport>>,
  dispatch: (action: PublishAction) => void,
): Promise<Remote<ChangeReport> | undefined> {
  dispatch({ type: 'look' })
  try {
    const answer = await look()
    dispatch({ type: 'looked', answer })
    return answer
  } catch (error) {
    dispatch({ type: 'look-errored', message: messageOf(error) })
    return undefined
  }
}

/**
 * Runs one Publish over `publish`, relaying every event to the machine. Ends in exactly one of
 * `published`, `failed`, `refused` or `error`.
 *
 * The stream is asked only when the machine (read through `current`) takes the start: from a
 * review or a refusal, once. A second confirmation while the first is starting sends nothing.
 */
export async function runPublish(
  publish: PublishStream,
  domainId: string,
  request: PublishRequest,
  dispatch: (action: PublishAction) => void,
  current: () => PublishState,
): Promise<void> {
  const before = current().phase
  if (before !== 'review' && before !== 'refused') return
  dispatch({ type: 'start', request })
  if (current().phase !== 'starting') return
  let settled = false
  try {
    const outcome = await publish(domainId, request, (event) => {
      if (event.type === 'result') settled = true
      dispatch({ type: 'event', event })
    })
    if ('refused' in outcome) {
      if (isRefusal(outcome.refused)) dispatch({ type: 'refused', refusal: outcome.refused })
      else
        dispatch({
          type: 'errored',
          message: `The Studio server refused with an answer it does not explain: ${JSON.stringify(outcome.refused)}`,
        })
    } else if (!settled) dispatch({ type: 'event', event: outcome.result })
  } catch (error) {
    if (!settled) dispatch({ type: 'errored', message: messageOf(error) })
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// ─── Words ───────────────────────────────────────────────────────────────────

/** What fixes a refusal: take the look again, choose another Environment, or nothing here. */
export type RefusalAction = 'look-again' | 'choose-environment' | 'try-again' | 'none'

export interface RefusalAdvice {
  headline: string
  remedy: string
  action: RefusalAction
}

/** Every refusal of the Studio server, as a sentence and the act that fixes it. */
export function refusalAdvice(refusal: Pick<PublishRefusal, 'error'>): RefusalAdvice {
  switch (refusal.error) {
    case 'publish-disabled':
      return {
        headline: 'Publishing is turned off for this Studio.',
        remedy:
          'It was started with ASTRALE_STUDIO_PUBLISH=off. Start it without that setting to publish from here; nothing was published.',
        action: 'none',
      }
    case 'look-missing':
      return {
        headline: 'The Studio no longer knows the change report this Publish relied on.',
        remedy: 'Take a fresh look, read it, and confirm again.',
        action: 'look-again',
      }
    case 'look-stale':
      return {
        headline:
          'The change report is stale: the sources changed, or it is older than 15 minutes.',
        remedy: 'Take a fresh look, read what changed, and confirm again.',
        action: 'look-again',
      }
    case 'look-refused':
      return {
        headline: 'The declared version does not reach the bump the changes require.',
        remedy:
          'Declare the version the change report asks for in package.json, then take a fresh look.',
        action: 'look-again',
      }
    case 'environment-unknown':
      return {
        headline: 'The Project declares no such Environment.',
        remedy: 'Choose an Environment astrale.config.ts declares.',
        action: 'choose-environment',
      }
    case 'publish-running':
      return {
        headline: 'Another Publish is running in this Studio.',
        remedy: 'Wait for it to finish, then try again.',
        action: 'try-again',
      }
    case 'tooling-missing':
      return {
        headline: "The Domain's publishing tool is not installed.",
        remedy: "Install the Domain's dependencies (they provide astrale-domain), then try again.",
        action: 'try-again',
      }
    case 'invalid-request':
      return {
        headline: 'The Studio server could not read the request.',
        remedy: 'Take a fresh look and confirm again.',
        action: 'look-again',
      }
  }
}

/** Why no change report could be taken, as the dialog says it. */
export function lookFailureWords(
  failure: Pick<RemoteFailure, 'status'>,
  origin: string,
): { headline: string; remedy: string } {
  return failureWords(failure, `the change report of ${origin}`)
}

// ─── The confirmation ────────────────────────────────────────────────────────

export interface PublishChoice {
  environment?: string
  /** What the reader typed to confirm: the declared version. */
  typed: string
  /** The reader acknowledged publishing without a commit, or from uncommitted changes. */
  allowDirty: boolean
}

export const NO_CHOICE: PublishChoice = { typed: '', allowDirty: false }

export interface Gate {
  ready: boolean
  /** Why the confirmation is not available yet, in the order to address them. */
  missing: string[]
  /** Passes `--allow-dirty`: the tree holds no commit, or uncommitted changes. */
  needsAllowDirty: boolean
}

/** Whether the reader may confirm, and what is missing. */
export function confirmGate(
  report: ChangeReport,
  local: DomainLocal | undefined,
  relation: PublicationRelation | undefined,
  choice: PublishChoice,
): Gate {
  const missing: string[] = []
  const needsAllowDirty = local === undefined || local.git === null || local.git.dirty
  if (!report.accepted && !report.published) {
    const next = nextVersion(report)
    missing.push(
      next
        ? `${report.declared} does not reach the bump the changes require: declare ${next} in package.json, then take a fresh look.`
        : `${report.declared} does not reach the bump the changes require: raise the version in package.json, then take a fresh look.`,
    )
  }
  if (relation?.kind === 'version-taken')
    missing.push(
      `${report.declared} is already published under another Schema revision: raise the version in package.json, then take a fresh look.`,
    )
  if (local && !local.environments.declared)
    missing.push('The Project declares no Environment: declare one in astrale.config.ts.')
  else if (!choice.environment) missing.push('Choose an Environment.')
  if (needsAllowDirty && !choice.allowDirty)
    missing.push(
      local?.git === null
        ? 'Acknowledge that no commit will be recorded.'
        : 'Acknowledge that uncommitted changes will be published.',
    )
  if (choice.typed.trim() !== report.declared) missing.push(`Type ${report.declared} to confirm.`)
  return { ready: missing.length === 0, missing, needsAllowDirty }
}

/** The request a confirmed choice sends. */
export function requestOf(report: ChangeReport, choice: PublishChoice, gate: Gate): PublishRequest {
  return {
    environment: choice.environment ?? '',
    look: report.look,
    ...(gate.needsAllowDirty && choice.allowDirty ? { allowDirty: true } : {}),
  }
}

/** The final report, as sentences. */
export function resultSentences(report: PublishReport): string[] {
  const sentences: string[] = []
  sentences.push(
    report.publication.status === 'created'
      ? `Published ${report.origin} ${report.publication.version} to ${report.environment}.`
      : `${report.origin} ${report.publication.version} was already published with this release: nothing new was tagged.`,
  )
  sentences.push(
    report.deployment === 'created'
      ? `A new deployment serves it at ${report.url}.`
      : report.deployment === 'reused'
        ? `The existing deployment at ${report.url} was reused.`
        : `No deployment was made; it is served at ${report.url}.`,
  )
  if (report.commit === null) sentences.push('No commit was recorded.')
  else
    sentences.push(
      `Recorded commit ${report.commit.sha.slice(0, 7)}${report.commit.dirty ? ', with uncommitted changes' : ''}.`,
    )
  return sentences
}

// ─── One run per Domain ──────────────────────────────────────────────────────

interface PublishRuns {
  runs: Record<string, PublishState>
  choices: Record<string, PublishChoice>
  dispatch: (domainId: string, action: PublishAction) => void
  choose: (domainId: string, choice: Partial<PublishChoice>) => void
}

export const usePublishRuns = create<PublishRuns>((set) => ({
  runs: {},
  choices: {},
  dispatch: (domainId, action) =>
    set((state) => {
      const before = state.runs[domainId] ?? IDLE_PUBLISH
      const after = publishReducer(before, action)
      if (after === before) return {}
      // a new look or a reset starts the choice over, except the Environment
      const choices =
        action.type === 'look' || action.type === 'reset'
          ? {
              ...state.choices,
              [domainId]: {
                ...NO_CHOICE,
                ...(state.choices[domainId]?.environment
                  ? { environment: state.choices[domainId]!.environment }
                  : {}),
              },
            }
          : state.choices
      return { runs: { ...state.runs, [domainId]: after }, choices }
    }),
  choose: (domainId, choice) =>
    set((state) => ({
      choices: {
        ...state.choices,
        [domainId]: { ...NO_CHOICE, ...state.choices[domainId], ...choice },
      },
    })),
}))
