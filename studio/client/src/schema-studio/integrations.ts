/**
 * The Integrations a Domain's runtime declares, as the Studio selects them, and what
 * another attempt of an operation may do. Read from the source overlay.
 */
import type {
  IntegrationLink,
  IntegrationReplay,
  StudioSchemaBundle,
} from '@shared/contracts/schema'

const PREFIX = 'integration.'

/** `integration.<key>`: the Studio selection of an Integration. */
export function integrationTarget(key: string): string {
  return `${PREFIX}${key}`
}

export function isIntegrationTarget(target: string): boolean {
  return target.startsWith(PREFIX)
}

export function integrationOfTarget(
  bundle: StudioSchemaBundle,
  target: string,
): IntegrationLink | undefined {
  const key = target.slice(PREFIX.length)
  return bundle.overlay.integrations.find((integration) => integration.key === key)
}

/** What another attempt may do, as a row says it: nothing when every attempt is safe. */
export function replayLabel(replay: readonly IntegrationReplay[]): string | undefined {
  return replay.every((kind) => kind === 'safe') ? undefined : replay.join(' or ')
}

const ATTEMPT: Record<IntegrationReplay, string> = {
  safe: 'does nothing more',
  keyed: 'takes effect once per key',
  unsafe: 'may repeat its effect',
}

/** What another attempt may do, said in full: what a replay label stands for. */
export function replayMeaning(replay: readonly IntegrationReplay[]): string | undefined {
  if (replay.length === 0) return undefined
  const attempt = replay.map((kind) => ATTEMPT[kind]).join(' or ')
  const sentence =
    replay.length > 1
      ? `Depending on its input, another attempt ${attempt}.`
      : `Another attempt ${attempt}.`
  return replay.includes('unsafe')
    ? `${sentence} Code that may run more than once, such as a Step, cannot call it.`
    : sentence
}
