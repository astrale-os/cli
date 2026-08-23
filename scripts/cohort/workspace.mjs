import { posix } from 'node:path'
import { parse } from 'yaml'

import { invalidConfiguration } from './error.mjs'
import { exactWorkspaceMembers } from './sources.mjs'

export function exactSourceWorkspace(input) {
  const workspace = parse(input)
  if (!Array.isArray(workspace?.packages)) invalidConfiguration('workspace packages')
  const members = workspace.packages.flatMap((member) => {
    if (typeof member !== 'string') invalidConfiguration('string workspace members')
    const excluded = member.startsWith('!')
    const normalized = posix.normalize(excluded ? member.slice(1) : member)
    return normalized === '.cohort' || normalized.startsWith('.cohort/')
      ? [`${excluded ? '!' : ''}${normalized}`]
      : []
  })
  const expected = new Set(exactWorkspaceMembers)
  if (members.length !== expected.size || members.some((member) => !expected.has(member))) {
    invalidConfiguration('the exact source workspace members')
  }
  return Object.freeze(members)
}
