/**
 * options.ts — reading an ACP session's configuration options.
 *
 * `session/new` (and every `session/set_config_option` answer) describes what the
 * agent can be told to do: which models it offers, which reasoning levels THIS
 * model has, and what each is currently set to. Both the probe that reports them
 * to the GUI and the turn that applies Studio's overrides read them the same way,
 * so the two never disagree about what an agent said.
 *
 * Ids are the agent's own (`effort` for Claude, `reasoning_effort` for Codex);
 * only the CATEGORY is common, so that is what the lookups key on.
 */
import type * as acp from '@agentclientprotocol/sdk'

import type { AgentEffort, HarnessEffortOption, HarnessModelOption } from '../../../../shared/types'
import type { AcpProvider } from './command'

import { isAgentEffort } from '../../../../shared/agent-effort'

export type SelectConfigOption = Extract<acp.SessionConfigOption, { type: 'select' }>

function selectByCategory(
  options: acp.SessionConfigOption[],
  id: string,
  category: string,
): SelectConfigOption | undefined {
  const option =
    options.find((candidate) => candidate.id === id) ??
    options.find((candidate) => candidate.category === category)
  return option?.type === 'select' ? option : undefined
}

export function modelConfig(options: acp.SessionConfigOption[]): SelectConfigOption | undefined {
  return selectByCategory(options, 'model', 'model')
}

/** The reasoning ladder — absent when the selected model does no reasoning. */
export function effortConfig(options: acp.SessionConfigOption[]): SelectConfigOption | undefined {
  const option = options.find((candidate) => candidate.category === 'thought_level')
  return option?.type === 'select' ? option : undefined
}

/** Flatten a select's rows, groups included, into `[value, name, description]`. */
function selectValues(config: SelectConfigOption) {
  return config.options.flatMap((option) => ('value' in option ? [option] : option.options))
}

/**
 * Rows that name no model.
 *
 * Claude Code offers a `default` row meaning "let me choose" — which resolves to
 * whatever that machine's own config says, and reads in the picker as a second
 * name for a model already listed below it. Studio resolves that question itself
 * (`AgentHarness.defaultModel` and the domain's starred model), so the row would
 * only be a third answer to it.
 */
const META_MODEL_IDS = new Set(['default'])

export function modelOptions(
  config: SelectConfigOption | undefined,
): HarnessModelOption[] | undefined {
  if (!config) return undefined
  return selectValues(config)
    .filter((value) => !META_MODEL_IDS.has(value.value))
    .map((value) => ({
      id: value.value,
      label: value.name,
      ...(value.description ? { description: value.description } : {}),
    }))
}

/** Studio's own top rung for Claude — implemented in `providerSessionMeta`. */
const ULTRACODE: HarnessEffortOption = {
  id: 'ultracode',
  label: 'Ultracode',
  description: 'Max reasoning, and Claude may fan the work out across subagents',
}

/**
 * The ladder as levels Studio can name.
 *
 * Anything outside the shared vocabulary is dropped, `default` included — for the
 * same reason as the model list: a chat that pins nothing already runs the agent's
 * own level, so a row naming it would only be a second name for a rung listed here.
 */
export function effortOptions(
  provider: AcpProvider,
  config: SelectConfigOption | undefined,
): HarnessEffortOption[] | undefined {
  if (!config) return undefined
  const levels = nativeEffortOptions(config)
  return provider === 'claude' ? [...levels, ULTRACODE] : levels
}

function nativeEffortOptions(config: SelectConfigOption): HarnessEffortOption[] {
  return selectValues(config)
    .filter((value) => isAgentEffort(value.value))
    .map((value) => ({
      id: value.value as AgentEffort,
      label: value.name,
      ...(value.description ? { description: value.description } : {}),
    }))
}

/**
 * The levels the agent will actually accept, for mapping a chat's pick onto them.
 *
 * `ultracode` is deliberately absent: it is not a value ACP takes, so a chat
 * pinned to it lands on the heaviest rung the agent does offer — and turns the
 * Studio-side flag on separately (`providerSessionMeta`).
 */
export function effortValues(config: SelectConfigOption | undefined): AgentEffort[] {
  return config ? nativeEffortOptions(config).map((option) => option.id) : []
}
