import { Boxes, MessageCircle, MessageSquare, Search, Workflow } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useWorkspace } from '@/lib/hooks'
import { useUI } from '@/lib/store'

import { useCanvasDomains } from './workspace/canvas-selection'

/** What moves with the domain you work in — everything the canvas does NOT decide. */
const CONSEQUENCES = [
  {
    icon: MessageCircle,
    label: 'Agent',
    detail: 'the conversation, its queued messages and its session',
  },
  { icon: MessageSquare, label: 'Comments', detail: 'the threads the work panel lists' },
  { icon: Boxes, label: 'Core', detail: 'reads one domain, and it becomes this one' },
  { icon: Workflow, label: 'Process', detail: 'same — one domain at a time' },
  { icon: Search, label: 'Search (⌘K)', detail: 'looks through this domain’s schema' },
]

/**
 * Working in another domain is not a canvas gesture: the canvas keeps drawing everything
 * it holds, and your selection stays where it is. What moves is the conversation you are
 * having and the two sections that read a single domain — which is worth saying out loud
 * once, rather than being discovered when a message lands in the wrong chat.
 */
export function ActivateDomainDialog() {
  const request = useUI((state) => state.domainSwitchRequest)
  const requestDomainSwitch = useUI((state) => state.requestDomainSwitch)
  const setConfirmDomainSwitch = useUI((state) => state.setConfirmDomainSwitch)
  const domainId = useUI((state) => state.domainId)
  const { data: domains } = useWorkspace()
  const { activate } = useCanvasDomains()
  const [dontAsk, setDontAsk] = useState(false)

  const current = domains?.find((domain) => domain.id === domainId)
  const close = () => {
    setDontAsk(false)
    requestDomainSwitch(null)
  }
  const confirm = () => {
    if (!request) return
    if (dontAsk) setConfirmDomainSwitch(false)
    activate(request.id)
    close()
  }

  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Work in {request?.origin}?</DialogTitle>
          <DialogDescription>
            The canvas keeps drawing every domain you checked, and your selection stays where it is.
            What follows the domain you work in is this:
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-2 py-1">
          {CONSEQUENCES.map(({ icon: Icon, label, detail }) => (
            <li key={label} className="flex items-start gap-2.5 text-[13px]">
              <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0">
                <span className="font-medium">{label}</span>{' '}
                <span className="text-muted-foreground">— {detail}</span>
              </span>
            </li>
          ))}
        </ul>
        {current && (
          <p className="text-[12px] text-muted-foreground">
            Nothing is lost: {current.origin}’s chats and threads are still there when you come back
            to it.
          </p>
        )}

        <DialogFooter className="items-center">
          <label className="mr-auto flex cursor-pointer items-center gap-2 text-[12px] text-muted-foreground">
            <input
              type="checkbox"
              checked={dontAsk}
              onChange={(event) => setDontAsk(event.target.checked)}
              className="h-3.5 w-3.5 accent-[var(--color-primary)]"
            />
            Don’t ask again
          </label>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button onClick={confirm}>Work in {request?.origin.split('.')[0]}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
