/**
 * The edits a reader makes to a Scenario, each a whole new Scenario: the route puts Scenarios
 * whole. Pure; an edit naming a step the Scenario no longer holds changes nothing.
 */

import type { Scenario, ScenarioExpect, ScenarioStep } from '@shared/contracts/scenarios'

import { SCENARIO_LIMITS } from '@shared/contracts/scenarios'

/** The step added at `at` (its end by default), unless the Scenario holds that id already. */
export function withStep(scenario: Scenario, step: ScenarioStep, at?: number): Scenario {
  if (scenario.steps.some((one) => one.id === step.id)) return scenario
  const steps = [...scenario.steps]
  steps.splice(at === undefined ? steps.length : Math.max(0, Math.min(at, steps.length)), 0, step)
  return { ...scenario, steps }
}

export function withoutStep(scenario: Scenario, id: string): Scenario {
  return { ...scenario, steps: scenario.steps.filter((one) => one.id !== id) }
}

/** The step moved `by` places, never past either end. */
export function moved(scenario: Scenario, id: string, by: number): Scenario {
  const from = scenario.steps.findIndex((one) => one.id === id)
  if (from < 0) return scenario
  const to = Math.max(0, Math.min(scenario.steps.length - 1, from + by))
  if (to === from) return scenario
  const steps = [...scenario.steps]
  const [step] = steps.splice(from, 1)
  steps.splice(to, 0, step!)
  return { ...scenario, steps }
}

/** The step expecting `expect`. */
export function expecting(scenario: Scenario, id: string, expect: ScenarioExpect): Scenario {
  return changed(scenario, id, (step) => ({ ...step, expect }))
}

/** The step with its note, or none when the note is blank. */
export function noted(scenario: Scenario, id: string, note: string): Scenario {
  const text = note.trim().slice(0, SCENARIO_LIMITS.note)
  return changed(scenario, id, ({ note: _note, ...step }) =>
    text ? ({ ...step, note: text } as ScenarioStep) : (step as ScenarioStep),
  )
}

/** The Scenario named anew; a blank name keeps the one it has. */
export function renamed(scenario: Scenario, name: string): Scenario {
  const text = name.trim().slice(0, SCENARIO_LIMITS.name)
  return text ? { ...scenario, name: text } : scenario
}

/** A name a Scenario can take: at most as long as the route keeps. */
export function nameOf(text: string): string {
  const trimmed = text.trim()
  return trimmed.length <= SCENARIO_LIMITS.name
    ? trimmed
    : `${trimmed.slice(0, SCENARIO_LIMITS.name - 1)}…`
}

function changed(
  scenario: Scenario,
  id: string,
  change: (step: ScenarioStep) => ScenarioStep,
): Scenario {
  if (!scenario.steps.some((one) => one.id === id)) return scenario
  return { ...scenario, steps: scenario.steps.map((one) => (one.id === id ? change(one) : one)) }
}
