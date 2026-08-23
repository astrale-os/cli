import { parse } from 'yaml'

import { invalidConfiguration } from './error.mjs'

const buildCommand = 'pnpm install --frozen-lockfile --ignore-scripts && pnpm check:cohort'

export function exactPublicationInstall(input) {
  const workflow = parse(input)
  const publication = workflow?.jobs?.publish?.steps?.find(
    ({ uses }) => uses === 'astrale-os/config/.github/actions/publish/packages@main',
  )
  if (publication?.with?.['build-command'] !== buildCommand) {
    invalidConfiguration('post-install publication source verification')
  }
  return true
}
