import type { ShellAdapter } from '@astrale-os/shell'

export function viewTitle(key: string): string {
  return `Astrale View /:${key}`
}

/** Give every Shell-created frame its selected View's stable accessible name. */
export function accessibleIframeAdapter(adapter: ShellAdapter): ShellAdapter {
  return {
    ...adapter,
    mount(config) {
      const mounted = adapter.mount(config)
      const title = viewTitle(config.functionId)
      mounted.handle.element.setAttribute('title', title)
      mounted.handle.element.setAttribute('aria-label', title)
      return mounted
    },
  }
}
