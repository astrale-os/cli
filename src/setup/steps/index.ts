import type { SetupStep } from '../types'

import { adminStep } from './admin'
import { agentBrowserStep } from './agent-browser'
import { authStep } from './auth'
import { domainStep } from './domain'
import { instanceStep } from './instance'
import { skillsStep } from './skills'

/** Required prerequisites, walked in order — each is a precondition for the next. */
export const CONNECT_STEPS: SetupStep[] = [authStep, adminStep, instanceStep]

/** Optional extras, offered together as a pre-checked multi-select. */
export const EQUIP_STEPS: SetupStep[] = [skillsStep, agentBrowserStep, domainStep]

export const ALL_STEPS: SetupStep[] = [...CONNECT_STEPS, ...EQUIP_STEPS]
