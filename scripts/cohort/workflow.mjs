import { parse } from 'yaml'

import { invalidConfiguration } from './error.mjs'
import { exactSources } from './sources.mjs'

const actionPath = './.github/actions/exact-sources'

/** Admit only the named jobs as thin exact-source callers. */
export function exactSourceWorkflow(input, expectedJobs, repositoryToken) {
  const workflow = parse(input)
  const jobs = workflow?.jobs
  if (jobs === null || typeof jobs !== 'object') invalidConfiguration('workflow jobs')
  for (const name of expectedJobs) {
    if (jobs[name] === undefined) invalidConfiguration(`workflow job ${name}`)
  }

  for (const [name, job] of Object.entries(jobs)) {
    const steps = job.steps ?? []
    const delegates = steps.filter(({ uses }) => uses === actionPath)
    const expected = expectedJobs.includes(name) ? 1 : 0
    if (delegates.length !== expected) {
      invalidConfiguration(`${expected} exact-source calls in job ${name}`)
    }
    if (delegates.some(({ with: values }) => values?.['repository-token'] !== repositoryToken)) {
      invalidConfiguration(`the repository credential in job ${name}`)
    }
    if (
      steps.some(({ with: values }) =>
        exactSources.some(({ repository }) => values?.repository === repository),
      )
    ) {
      invalidConfiguration(`no workflow-owned source checkout in job ${name}`)
    }
  }
  return Object.freeze(expectedJobs)
}
