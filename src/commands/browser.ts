import chalk from 'chalk'
import { existsSync } from 'node:fs'

import type { CommandDefinition } from '../program/index'

import {
  ab,
  AGENT_BROWSER_REPO,
  type BrowserSession,
  findAgentBrowser,
  navigateAndCheck,
  pollAuth,
  profileDirFor,
  saveSession,
} from '../lib/browser'
import { sweepBrowserProfiles } from '../lib/browser-retention'
import { readLocalStatus } from '../lib/local-status'
import { fatal, log, withSpinner } from '../lib/log'
import { isMachine, output, RAW_OUTPUT_OPTIONS, type RawOutputOpts } from '../lib/output'

type BrowserOpts = RawOutputOpts & {
  url?: string
  cdp?: string
  profile?: string
  login?: boolean
  check?: boolean
}

/**
 * Opportunistic profile retention, the same `git gc --auto` shape the session
 * store uses: no daemon, no cron, it just rides on the command that created the
 * mess. Silent when there is nothing to do, and never fatal — losing a sweep is
 * strictly better than losing the browser command.
 */
async function reportSweep(machine: boolean): Promise<void> {
  try {
    const swept = await sweepBrowserProfiles()
    if (machine || swept.bytesFreed === 0) return
    const freed = `${(swept.bytesFreed / 1024 / 1024).toFixed(0)} MB`
    const what = [
      swept.removed.length > 0 ? `${swept.removed.length} dormant profile(s) removed` : null,
      swept.purged.length > 0 ? `${swept.purged.length} cache(s) trimmed` : null,
    ]
      .filter(Boolean)
      .join(', ')
    log.dim(`retention: ${what} — ${freed} freed`)
  } catch {
    /* retention must never break the browser command */
  }
}

const LOGIN_TIMEOUT_MS = 180_000
const POLL_INTERVAL_MS = 2500

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Resolve the GUI origin for the active instance (or an explicit --url). */
async function resolveGuiOrigin(explicit?: string): Promise<string> {
  let target = explicit
  if (!target) {
    const status = await readLocalStatus()
    target = status.instance?.url ?? undefined
  }
  if (!target) {
    fatal(
      new Error(
        'No target instance. Set one with `astrale instance use <name>`, or pass `--url <gui-url>`.',
      ),
    )
  }
  try {
    return new URL(target).origin
  } catch {
    return fatal(new Error(`Invalid instance URL: ${target}`))
  }
}

function requireAgentBrowser(machine: boolean, opts: RawOutputOpts): Promise<string> {
  return findAgentBrowser().then((bin) => {
    if (bin) return bin
    if (machine) {
      output({ error: 'agent-browser-not-installed', repo: AGENT_BROWSER_REPO }, opts)
    } else {
      log.error('agent-browser is not installed — it is the engine `astrale browser` drives.')
      log.dim('  Install it:')
      log.dim('    npm install -g agent-browser && agent-browser install')
      log.dim('  Recommended — also install its agent skill so your coding agent knows it:')
      log.dim(`    npx skills add ${AGENT_BROWSER_REPO}`)
    }
    process.exit(1)
  })
}

function reportConnected(session: BrowserSession, machine: boolean, opts: RawOutputOpts): void {
  if (machine) {
    output({ connected: true, ...session }, opts)
    return
  }
  const drive = session.profile ? `--profile ${session.profile}` : `--cdp ${session.cdp}`
  log.success(
    `Connected to ${chalk.bold(session.url)}${session.email ? ` as ${session.email}` : ''}`,
  )
  log.dim(`  session saved → ~/.astrale/browser.json (reused automatically next time)`)
  console.log('')
  console.log(chalk.bold('Drive it:'))
  console.log(`  agent-browser ${drive} snapshot`)
  console.log(`  agent-browser ${drive} open ${session.url}`)
  console.log(`  agent-browser ${drive} click @e3`)
}

export default {
  name: 'browser',
  description: 'Open a reusable, authenticated browser session your agent can drive',
  options: [
    { flags: '--url <url>', description: 'GUI URL to connect (default: active instance)' },
    {
      flags: '--cdp <endpoint>',
      description: 'Attach to a running Chrome (port or ws URL) instead of a profile',
    },
    { flags: '--profile <dir>', description: 'Override the persistent profile directory' },
    { flags: '--login', description: 'Force interactive sign-in even if a session exists' },
    { flags: '--check', description: 'Report session status only; never open a window' },
    ...RAW_OUTPUT_OPTIONS,
  ],
  afterHelpText: `
What it does:
  Wires your coding agent to the live Astrale GUI. It owns the *session* — pins a
  persistent per-instance profile, runs the one-time WorkOS sign-in, and verifies
  auth. Driving the page is agent-browser's job: once connected, your agent runs
  \`agent-browser --profile <dir> snapshot|open|click|eval\` directly.

  The GUI session is an httpOnly cookie with no token-injection path, so "use my
  session" means driving a browser whose profile holds the cookie. You sign in
  once; the profile keeps it and every later run is silent.

Requires agent-browser (https://github.com/${AGENT_BROWSER_REPO}):
  npm install -g agent-browser && agent-browser install
  npx skills add ${AGENT_BROWSER_REPO}     # recommended: teaches the agent its commands

Examples:
  $ astrale browser                  # connect the active instance (sign in once)
  $ astrale browser --check          # is the saved session still authenticated?
  $ astrale browser --login          # force a fresh sign-in
  $ astrale browser --cdp 9222       # attach to a Chrome you already have open
`,
  action: async (opts: BrowserOpts) => {
    const machine = isMachine(opts)
    const gui = await resolveGuiOrigin(opts.url)
    const host = new URL(gui).host
    await requireAgentBrowser(machine, opts)

    // Retention runs BEFORE anything launches, so no profile we touch can be in
    // use by a browser this command started. Profiles held by someone else's
    // live browser are skipped by the sweep itself.
    await reportSweep(machine)

    const usingCdp = !!opts.cdp
    const profile = usingCdp ? null : (opts.profile ?? profileDirFor(host))
    const target = usingCdp ? { cdp: opts.cdp } : { profile: profile! }

    const persist = async (state: { email?: string }): Promise<BrowserSession> => {
      const session: BrowserSession = {
        url: gui,
        host,
        profile,
        cdp: opts.cdp ?? null,
        email: state.email,
        updatedAt: new Date().toISOString(),
      }
      await saveSession(session)
      return session
    }

    // Attach mode: the external Chrome is the user's — never drive its login.
    if (usingCdp) {
      const state = await withSpinner(`Checking the Chrome attached on ${opts.cdp}`, !machine, () =>
        navigateAndCheck(gui, target),
      )
      if (!state.authed) {
        if (machine) output({ connected: false, url: gui, host, cdp: opts.cdp }, opts)
        else {
          log.warn(`Attached to Chrome on ${opts.cdp}, but not signed in to ${gui}.`)
          log.dim('  Sign in in that browser window, then re-run `astrale browser --cdp ...`.')
        }
        process.exit(1)
      }
      reportConnected(await persist(state), machine, opts)
      return
    }

    // Profile mode: silent (headless) reuse check when the profile may already
    // hold a cookie. Skip for a brand-new profile — nothing to reuse, and it
    // avoids a throwaway headless navigation before the sign-in window opens.
    if (!opts.login && profile && existsSync(profile)) {
      const reused = await withSpinner('Checking your saved browser session', !machine, () =>
        navigateAndCheck(gui, target),
      )
      if (reused.authed) {
        reportConnected(await persist(reused), machine, opts)
        return
      }
    }

    // Not authenticated. In check/machine mode we never pop a window.
    if (opts.check || machine) {
      if (machine) output({ connected: false, url: gui, host, profile }, opts)
      else {
        log.warn(`No authenticated session for ${gui}.`)
        log.dim('  Run `astrale browser` (without --check) to sign in.')
      }
      process.exit(1)
    }

    // Interactive sign-in: open a HEADED window and poll until the router sets
    // the cookie. Every command on this browser must carry `headed:true` —
    // agent-browser defaults to headless, and an unflagged command flips the
    // live window back to headless (closing it mid-login). Proven: a poll
    // `eval` without --headed turns HEADED → HEADLESS on the next call.
    const headedTarget = { ...target, headed: true }
    log.step(`Opening ${chalk.bold(gui)} — sign in with your Astrale account in the window…`)
    await ab(['close'], target) // release any stale browser on this profile
    await ab(['open', gui], headedTarget)

    const deadline = Date.now() + LOGIN_TIMEOUT_MS
    const state = await withSpinner(
      'Waiting for you to sign in in the browser window',
      !machine,
      async () => {
        let seen = { authed: false } as { authed: boolean; email?: string }
        while (Date.now() < deadline) {
          await sleep(POLL_INTERVAL_MS)
          seen = await pollAuth(headedTarget)
          if (seen.authed) break
        }
        return seen
      },
      { safetyMs: LOGIN_TIMEOUT_MS },
    )
    if (!state.authed) {
      fatal(
        new Error(
          `Sign-in not detected within ${LOGIN_TIMEOUT_MS / 1000}s. Re-run \`astrale browser\`.`,
        ),
      )
    }
    reportConnected(await persist(state), machine, opts)
  },
} satisfies CommandDefinition
