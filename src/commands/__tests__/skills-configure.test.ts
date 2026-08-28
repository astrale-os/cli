import { describe, expect, test } from 'bun:test'

import { astraleSkillAgentChoices } from '../skills/configure'

describe('Astrale skill agent selection', () => {
  test('checks configured agents but only labels detected agents', () => {
    const choices = astraleSkillAgentChoices([
      {
        name: 'detected',
        displayName: 'Detected Agent',
        globalSkillsDir: '/detected/skills',
        detected: true,
        configured: false,
      },
      {
        name: 'configured',
        displayName: 'Configured Agent',
        globalSkillsDir: '/configured/skills',
        detected: true,
        configured: true,
      },
      {
        name: 'absent',
        displayName: 'Absent Agent',
        globalSkillsDir: '/absent/skills',
        detected: false,
        configured: false,
      },
    ])

    expect(choices).toEqual([
      {
        name: 'Configured Agent (configured)',
        value: 'configured',
        checked: true,
        description: '/configured/skills',
      },
      {
        name: 'Detected Agent (detected)',
        value: 'detected',
        checked: false,
        description: '/detected/skills',
      },
      {
        name: 'Absent Agent',
        value: 'absent',
        checked: false,
        description: '/absent/skills',
      },
    ])
  })
})
