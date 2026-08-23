import { parse } from 'yaml'

import { invalidConfiguration } from './error.mjs'
import { exactSources } from './sources.mjs'

/** Read the exact source revisions from the one action that owns them. */
export function exactSourceAction(input) {
  const action = parse(input)
  const inputNames = Object.keys(action?.inputs ?? {})
  if (
    inputNames.length !== 1 ||
    inputNames[0] !== 'repository-token' ||
    action.inputs['repository-token'].required !== true
  ) {
    invalidConfiguration('one required repository token')
  }

  const steps = action?.runs?.steps
  if (!Array.isArray(steps)) invalidConfiguration('composite action steps')
  const checkouts = steps.filter(({ uses }) => uses === 'actions/checkout@v4')
  if (checkouts.length !== exactSources.length) {
    invalidConfiguration('one checkout per exact source')
  }

  const revisions = {}
  for (const source of exactSources) {
    const matches = checkouts.filter(({ with: values }) => values?.repository === source.repository)
    if (matches.length !== 1) invalidConfiguration(`one ${source.name} checkout`)
    const values = matches[0].with
    if (
      values.path !== source.path ||
      values.token !== '${{ inputs.repository-token }}' ||
      values['persist-credentials'] !== false ||
      !/^[0-9a-f]{40}$/u.test(values.ref)
    ) {
      invalidConfiguration(`the admitted ${source.name} checkout`)
    }
    revisions[source.name] = values.ref
  }

  const binding = steps.find(({ name }) => name === 'Bind SDK-owned Kernel source links')?.run
  if (
    typeof binding !== 'string' ||
    !binding.includes('mkdir -p .cohort/sdk/.cohort') ||
    !binding.includes('ln -s ../../kernel .cohort/sdk/.cohort/kernel')
  ) {
    invalidConfiguration('the SDK-owned Kernel source binding')
  }
  return Object.freeze(revisions)
}
