import type { ConnectionOptions } from '../../connection/target'
import type { InstanceStore } from '../instance'

/** Select existing authority before reading; a denied read never enters this selection again. */
export function investigationTarget(
  options: ConnectionOptions,
  issuer: string,
  store: InstanceStore,
): ConnectionOptions {
  const matches = Object.entries(store.instances).filter(
    ([, entry]) => (entry.issuer ?? entry.url) === issuer,
  )
  const named =
    options.instance === undefined
      ? undefined
      : Object.entries(store.instances).find(([key, entry]) =>
          [key, entry.slug, entry.name].includes(options.instance!),
        )
  if (named && (named[1].issuer ?? named[1].url) !== issuer)
    throw new TypeError('Selected bookmark does not match the trace issuer')
  if (options.url && !options.instance && options.url !== issuer)
    throw new TypeError(
      'Selected URL does not match the trace issuer; use a bookmark for a transport alias',
    )
  if (!options.instance && !options.url && matches.length > 1)
    throw new TypeError('Multiple bookmarks match the trace issuer; select --instance')
  const bookmark = named ?? (matches.length === 1 ? matches[0] : undefined)
  const selected =
    options.instance || options.url
      ? options
      : bookmark
        ? { ...options, instance: bookmark[0] }
        : { ...options, url: issuer }
  const identity = options.as ?? bookmark?.[1].operatorIdentity
  return {
    ...selected,
    ...(identity && !options.creds && !options.anonymous ? { as: identity } : {}),
  }
}
