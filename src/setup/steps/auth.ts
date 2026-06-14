import type { SetupContext, SetupStep } from '../types'

import { readLocalStatus } from '../../lib/local-status'
import { log } from '../../lib/log'
import { loginViaIdp } from '../../lib/login-flow'

const FIX = 'astrale auth login'

/**
 * Step 1 — a WorkOS-backed identity with a live token. Provisioning an instance
 * requires an `idp` identity (not the local seed key), so "satisfied" means
 * signed in AND the cached session is fresh.
 */
export const authStep: SetupStep = {
  id: 'auth',
  title: 'Sign in',
  group: 'connect',

  async detect() {
    const { identity } = await readLocalStatus()
    if (!identity || identity.source !== 'idp') {
      return { state: 'gap', summary: 'Not signed in', fixHint: FIX }
    }
    const session = identity.session
    if (!session || !session.cached) {
      return { state: 'gap', summary: `No cached token for "${identity.name}"`, fixHint: FIX }
    }
    if (session.expired) {
      return { state: 'gap', summary: `Session for "${identity.name}" expired`, fixHint: FIX }
    }
    return {
      state: 'satisfied',
      summary: `Signed in as ${identity.name}`,
      detail: identity.subject,
    }
  },

  async ensure(ctx: SetupContext) {
    const detection = await authStep.detect(ctx)
    if (detection.state === 'satisfied') {
      log.success(detection.summary)
      return 'unchanged'
    }

    log.step('Sign in with your Astrale account (a URL + code will appear) …')
    const { identityName } = await loginViaIdp({ use: true })
    log.success(`Signed in as "${identityName}"`)
    return 'fixed'
  },
}
