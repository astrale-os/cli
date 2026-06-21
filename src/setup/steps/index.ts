import type { SetupStep } from '../types'

import { adminStep } from './admin'
import { agentBrowserStep } from './agent-browser'
import { authStep } from './auth'
import { domainStep } from './domain'
import { instanceStep } from './instance'
import { skillsStep } from './skills'
import { skillsBridgeStep } from './skills-bridge'

/** Required prerequisites, walked in order — each is a precondition for the next. */
export const CONNECT_STEPS: SetupStep[] = [authStep, adminStep, instanceStep]

/** Optional extras, offered together as a pre-checked multi-select. The skills
 *  bridge runs first so the per-skill steps below detect against the bridged state. */
export const EQUIP_STEPS: SetupStep[] = [skillsBridgeStep, skillsStep, agentBrowserStep, domainStep]

export const ALL_STEPS: SetupStep[] = [...CONNECT_STEPS, ...EQUIP_STEPS]
