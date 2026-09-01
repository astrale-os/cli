import {
  AGENT_ACCESS_LEVELS,
  type AgentAccess,
  type HarnessStatus,
  type StudioSettings,
} from '@shared/types'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronRight } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { EnvEditor } from '@/components/env-editor'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { api, qk } from '@/lib/api'
import { useHarness, useSettings } from '@/lib/hooks'
import { useUI } from '@/lib/store'

import { AgentDetails, AgentSettings } from './agent'
import { AppearanceSettings } from './appearance'
import { generalSettingsPatch, SettingsFields } from './fields'
import { HarnessGatewaySettings } from './gateway'

interface SettingsSaveInput {
  settings: StudioSettings
  harness?: HarnessStatus
  values: Record<string, string>
}

/**
 * The studio's settings. `StudioSettings` is one file for the whole workspace — how hard
 * the agent thinks, which model it opens on, how long extraction may take — so none of it
 * moves when you change the domain you work in.
 *
 * A few rows below still belong to ONE domain, because what they configure does: which
 * harness that domain talks to, its gateway credentials, its .env files. They say so.
 */
export function SettingsDialog() {
  const open = useUI((state) => state.settingsOpen)
  const setOpen = useUI((state) => state.setSettingsOpen)
  const domainId = useUI((state) => state.domainId)
  const { data: settings } = useSettings()
  const { data: harness } = useHarness(open ? domainId : undefined)
  const queryClient = useQueryClient()
  const [values, setValues] = useState<Record<string, string>>({})
  const [detailsOpen, setDetailsOpen] = useState(false)
  const detailsStartRef = useRef<HTMLDivElement>(null)

  const changeOpen = (nextOpen: boolean) => {
    if (!nextOpen) setDetailsOpen(false)
    setOpen(nextOpen)
  }

  useEffect(() => {
    if (!settings) return
    setValues(
      Object.fromEntries(
        Object.entries(settings)
          .filter(([, value]) => typeof value !== 'object')
          .map(([key, value]) => [key, String(value)]),
      ),
    )
  }, [settings])

  useLayoutEffect(() => {
    if (detailsOpen) detailsStartRef.current?.scrollIntoView({ block: 'start' })
  }, [detailsOpen])

  const save = useMutation({
    mutationFn: async (input: SettingsSaveInput) => {
      const patch = generalSettingsPatch(input.values, input.settings)
      const accessLevels = input.harness?.capabilities.accessLevels ?? [...AGENT_ACCESS_LEVELS]
      const access = accessLevels.includes(input.values.agentAccess as AgentAccess)
        ? (input.values.agentAccess as AgentAccess)
        : accessLevels.includes('full')
          ? 'full'
          : accessLevels[0]
      if (access) patch.agentAccess = access
      return api.updateSettings(patch as Partial<StudioSettings>)
    },
    // Every domain composes its anatomy through `integrationsDir` and runs its agent on
    // these values, so a save is news to all of them — the key prefixes below drop the
    // per-domain caches wholesale rather than naming the domain that happened to be open.
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.settings })
      queryClient.invalidateQueries({ queryKey: ['anatomy'] })
      queryClient.invalidateQueries({ queryKey: ['agent'] })
      queryClient.invalidateQueries({ queryKey: ['loadout'] })
      toast.success('Settings saved')
      changeOpen(false)
    },
    onError: (error) => toast.error(String(error)),
  })

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Studio-wide — saved to .domain-studio/settings.json</DialogDescription>
        </DialogHeader>
        <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen} className="contents">
          <div className="-mx-1 max-h-[60vh] space-y-5 overflow-y-auto px-1">
            <AppearanceSettings />
            <AgentSettings harness={harness} />
            <CollapsibleContent
              forceMount
              className="overflow-hidden data-[state=open]:animate-in data-[state=closed]:hidden"
            >
              <div ref={detailsStartRef} className="space-y-5 border-t border-border/70 pt-5">
                <SettingsFields
                  values={values}
                  onChange={(key, value) => setValues((current) => ({ ...current, [key]: value }))}
                />
                <EnvEditor domainId={domainId} />
                <HarnessGatewaySettings domainId={domainId} harness={harness} />
                <AgentDetails
                  domainId={open ? domainId : undefined}
                  settings={settings}
                  harness={harness}
                  values={values}
                  setValues={setValues}
                />
              </div>
            </CollapsibleContent>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="group/details inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ChevronRight className="h-3.5 w-3.5 transition-transform group-data-[state=open]/details:rotate-90" />
                Details
              </button>
            </CollapsibleTrigger>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => changeOpen(false)}
                className="rounded-md px-3 py-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!settings || save.isPending}
                onClick={() =>
                  save.mutate({
                    settings: settings!,
                    harness,
                    values: { ...values },
                  })
                }
                className="rounded-md bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>
        </Collapsible>
      </DialogContent>
    </Dialog>
  )
}
