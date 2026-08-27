export interface ViewToken {
  readonly token: string
  readonly expiresAt: number
  readonly kind: string
}

export interface ViewTokenBroker {
  current(): ViewToken
  resolve(): Promise<{ readonly credential: string }>
  refresh(): Promise<{ readonly token: string; readonly expiresAt: number }>
}

const DEFAULT_REFRESH_MARGIN_MS = 60_000

/** Keep the Shell host session and iframe handshake on one proactively refreshed credential. */
export function createViewTokenBroker(
  initial: ViewToken,
  load: () => Promise<ViewToken>,
  now: () => number = Date.now,
  refreshMarginMs = DEFAULT_REFRESH_MARGIN_MS,
): ViewTokenBroker {
  let current = initial
  let pending: Promise<ViewToken> | undefined

  const reload = async (): Promise<ViewToken> => {
    pending ??= load().then((next) => {
      current = next
      return next
    })
    try {
      return await pending
    } finally {
      pending = undefined
    }
  }

  return Object.freeze({
    current: () => current,
    async resolve() {
      const admitted = current.expiresAt - now() <= refreshMarginMs ? await reload() : current
      return Object.freeze({ credential: admitted.token })
    },
    async refresh() {
      const admitted = await reload()
      return Object.freeze({ token: admitted.token, expiresAt: admitted.expiresAt })
    },
  })
}
