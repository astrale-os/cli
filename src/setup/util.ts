import { validateSlug, validateUrl } from '../lib/validation'

/**
 * The clickable GUI origin for an instance — its kernel URL stripped of the
 * `/api` path bookmarks carry (`https://app.eu.astrale.ai/api` →
 * `https://app.eu.astrale.ai`). This is the URL we put in front of the user.
 */
export function guiOrigin(kernelUrl: string): string {
  try {
    return new URL(kernelUrl).origin
  } catch {
    return kernelUrl
  }
}

/** inquirer `validate`: true when the slug is valid, else the human message. */
export function slugError(value: string): true | string {
  try {
    validateSlug(value)
    return true
  } catch (e) {
    return e instanceof Error ? e.message : 'Invalid slug'
  }
}

/** inquirer `validate`: true when the value is an http(s) URL, else the message. */
export function urlError(value: string): true | string {
  try {
    validateUrl(value)
    return true
  } catch (e) {
    return e instanceof Error ? e.message : 'Invalid URL'
  }
}
