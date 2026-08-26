import type { ExternalOpenRequest, IntentMessage, Shell } from '@astrale-os/shell'

import { replyToIntent } from '@astrale-os/shell'

export interface ExternalOpenIntentHost {
  open(request: ExternalOpenRequest): boolean
}

/** Register the root host's browser-owned external navigation effect. */
export function installExternalOpenIntentHandler(
  shell: Shell,
  host: ExternalOpenIntentHost,
): () => void {
  return shell.onIntent('browser.openExternal', (message) => {
    const opened = host.open(message.envelope.payload)
    replyToIntent(shell.children, message.envelope.sender.windowId, message, {
      outcome: opened ? 'opened' : 'blocked',
    })
  })
}

/** Open an external document without retaining a cross-origin opener capability. */
export function openExternalBrowserWindow(
  browser: Pick<Window, 'open'>,
  request: ExternalOpenRequest,
): boolean {
  const popup = request.mode === 'popup'
  const opened = browser.open('', '_blank', popup ? 'popup,width=720,height=760' : undefined)
  if (opened === null) return false
  try {
    opened.opener = null
    if (opened.opener !== null) throw new Error('Browser retained the opener capability.')
    opened.location.replace(request.url)
  } catch {
    opened.close()
    return false
  }
  return true
}

export type ExternalOpenIntentMessage = IntentMessage<'browser.openExternal'>
