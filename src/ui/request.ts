import { run } from '../lib/proc'
import { UiError } from './model'

export const UI_REQUEST_LIMITS = {
  queryCodePoints: 512,
  draftUrlUtf8Bytes: 8 * 1024,
} as const

export type UiRequestDraft = {
  readonly query: string
  readonly submissionUrl: `https://github.com/astrale-os/ui/issues/new?${string}`
}

export type UiRequestLauncher = (
  file: string,
  args: readonly string[],
) => Promise<{ readonly code: number }>

function normalizeQuery(value: string): string {
  return value.replaceAll('\r\n', '\n').replaceAll('\r', '\n').trim()
}

export function createUiRequestDraft(query: string): UiRequestDraft {
  const normalized = normalizeQuery(query)
  if (!normalized || [...normalized].length > UI_REQUEST_LIMITS.queryCodePoints) {
    throw new UiError(
      'UI_REQUEST_QUERY_INVALID',
      `UI request intent must contain 1-${UI_REQUEST_LIMITS.queryCodePoints} Unicode characters.`,
      'Describe the desired UI outcome and observable behavior in one bounded request.',
    )
  }
  const url = new URL('https://github.com/astrale-os/ui/issues/new')
  url.searchParams.set('template', 'ui-request.yml')
  url.searchParams.set('need', normalized)
  const submissionUrl = url.toString()
  if (Buffer.byteLength(submissionUrl, 'utf8') > UI_REQUEST_LIMITS.draftUrlUtf8Bytes) {
    throw new UiError(
      'UI_REQUEST_UNAVAILABLE',
      'The UI request is too large for the GitHub form transport.',
      'Shorten the request and add detailed references after opening the form.',
    )
  }
  return { query: normalized, submissionUrl: submissionUrl as UiRequestDraft['submissionUrl'] }
}

export function browserInvocation(
  url: string,
  platform: NodeJS.Platform = process.platform,
): readonly [string, readonly string[]] {
  if (platform === 'darwin') return ['open', [url]]
  if (platform === 'win32') return ['rundll32.exe', ['url.dll,FileProtocolHandler', url]]
  return ['xdg-open', [url]]
}

const defaultLauncher: UiRequestLauncher = async (file, args) => run(file, [...args])

export async function requestUi(
  query: string,
  options: { readonly open: boolean; readonly launcher?: UiRequestLauncher },
): Promise<UiRequestDraft> {
  const draft = createUiRequestDraft(query)
  if (!options.open) return draft
  const [file, args] = browserInvocation(draft.submissionUrl)
  try {
    await (options.launcher ?? defaultLauncher)(file, args)
  } catch {
    // The printed draft URL remains the supported fallback.
  }
  return draft
}
