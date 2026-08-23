import { parse } from 'yaml'

import { invalidConfiguration } from './error.mjs'

const tokenName = 'COHORT_REPOSITORY_TOKEN'

/** Admit the reusable release workflow's one narrow repository secret. */
export function exactReleaseSecret(callerInput, calleeInput) {
  const caller = parse(callerInput)
  const callee = parse(calleeInput)
  const declaration = callee?.on?.workflow_call?.secrets
  if (
    Object.keys(declaration ?? {}).join() !== tokenName ||
    declaration[tokenName].required !== true
  ) {
    invalidConfiguration('one required reusable repository secret')
  }
  const supplied = caller?.jobs?.binary?.secrets
  if (
    Object.keys(supplied ?? {}).join() !== tokenName ||
    supplied[tokenName] !== '${{ secrets.COHORT_REPOSITORY_TOKEN }}'
  ) {
    invalidConfiguration('one exact reusable repository secret mapping')
  }
  return tokenName
}
