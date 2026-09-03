import type { DomainIntrospectionTiming, IntrospectionPhase } from '@shared/types'

const PHASE_LABELS: Record<IntrospectionPhase, string> = {
  queued: 'Waiting for an introspection slot',
  'cache-key': 'Checking source cache',
  'cache-read': 'Reading cached schema',
  dependencies: 'Checking dependencies',
  'runtime-extract': 'Compiling schema',
  'static-overlay': 'Reading TypeScript structure',
  fingerprint: 'Fingerprinting schema',
  'cache-write': 'Saving schema cache',
  anatomy: 'Reading domain structure',
  complete: 'Preparing domain structure',
}

export function introspectionPhaseLabel(timing?: DomainIntrospectionTiming): string {
  return timing ? PHASE_LABELS[timing.phase] : 'Waiting'
}
