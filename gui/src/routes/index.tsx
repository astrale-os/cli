import { createFileRoute } from '@tanstack/react-router'
import { useEffect } from 'react'

/**
 * The gui has no standalone landing — it exists only in the context of an
 * instance (mounting iframes, delegation tokens, intents). Redirect the root
 * URL to the playground, which has the actual instances list and a link
 * back to `http://localhost:3400/kernel/<id>` for each instance.
 */
function IndexPage() {
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.location.replace('http://localhost:3200/')
    }
  }, [])
  return (
    <div className="h-full w-full flex items-center justify-center text-sm text-muted-foreground">
      Redirecting to playground…
    </div>
  )
}

export const Route = createFileRoute('/')({
  component: IndexPage,
})
