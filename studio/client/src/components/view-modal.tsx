import { ExternalLink, Loader2, MonitorPlay, Rocket, TriangleAlert } from 'lucide-react'

import { useViewUrl } from '@/lib/hooks'
import { cn } from '@/lib/utils'

import { ShellPreview } from './shell-preview'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'

/**
 * ViewModal — renders a domain view live, in an iframe. The URL is resolved
 * lazily (only while open) from the view node installed on the domain's target
 * instance (ground truth). If the domain isn't installed / reachable, it shows a
 * graceful callout instead of a broken frame. Public views embed directly;
 * auth-gated ones may 403 in the frame, so an "Open in new tab" escape is always
 * offered.
 */
export function ViewModal({
  domainId,
  slug,
  label,
  open,
  onOpenChange,
}: {
  domainId: string
  slug: string
  label?: string
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const { data, isLoading, isError } = useViewUrl(domainId, slug, open)
  const rawUrl = data?.status === 'installed' ? (data.url ?? null) : null
  // Never embed a SAME-ORIGIN url with allow-same-origin + allow-scripts (it could script the
  // studio). View URLs are always remote (svc.astrale.ai), so this only blocks an anomaly — but
  // the new-tab link still works.
  const embeddable = !!rawUrl && isCrossOrigin(rawUrl)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid h-[86vh] w-[92vw] max-w-6xl grid-rows-[auto_1fr] gap-0 overflow-hidden p-0">
        <div className="flex items-center gap-2 border-b px-4 py-2.5">
          <MonitorPlay className="h-4 w-4 shrink-0 text-primary" />
          <DialogTitle className="truncate text-sm font-semibold">{label ?? slug}</DialogTitle>
          <code className="truncate text-[11px] text-muted-foreground">{slug}</code>
          {rawUrl && (
            <a
              href={rawUrl}
              target="_blank"
              rel="noreferrer"
              className="ml-auto mr-8 inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <ExternalLink className="h-3.5 w-3.5" /> Open in new tab
            </a>
          )}
        </div>

        <div className="relative min-h-0 bg-muted/20">
          {isLoading ? (
            <Centered>
              <Loader2 className="h-5 w-5 animate-spin" />
              Resolving the live view…
            </Centered>
          ) : embeddable && rawUrl ? (
            <ShellPreview domainId={domainId} slug={slug} url={rawUrl} />
          ) : (
            <NotLive status={isError ? 'error' : rawUrl ? 'blocked' : data?.status} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function isCrossOrigin(u: string): boolean {
  try {
    return new URL(u, window.location.href).origin !== window.location.origin
  } catch {
    return false
  }
}

function Centered({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'flex h-full items-center justify-center gap-2 text-sm text-muted-foreground',
        className,
      )}
    >
      {children}
    </div>
  )
}

function NotLive({ status }: { status?: string }) {
  const msg =
    status === 'not-installed'
      ? {
          icon: <Rocket className="h-6 w-6" />,
          title: 'Not installed on its target instance',
          hint: 'Deploy this domain (Deploy & install) to view it live here.',
        }
      : status === 'error'
        ? {
            icon: <TriangleAlert className="h-6 w-6 text-warning" />,
            title: 'Could not resolve the view',
            hint: 'Something went wrong reaching the instance.',
          }
        : status === 'blocked'
          ? {
              icon: <TriangleAlert className="h-6 w-6 text-warning" />,
              title: 'Same-origin view — not embedded',
              hint: 'This view resolved to the studio’s own origin; open it in a new tab instead.',
            }
          : {
              icon: <TriangleAlert className="h-6 w-6" />,
              title: "Couldn't reach the instance",
              hint: 'The target instance is offline, not bookmarked, or not authenticated.',
            }
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      <div className="text-muted-foreground/70">{msg.icon}</div>
      <div className="text-sm font-medium">{msg.title}</div>
      <div className="max-w-sm text-[13px] text-muted-foreground">{msg.hint}</div>
    </div>
  )
}
