import { type KernelInstanceInfoSchema } from '@astrale-os/kernel-host/manager-schema'
import { useNavigate } from '@tanstack/react-router'
import {
  Server,
  Play,
  Square,
  RotateCcw,
  Trash2,
  Plus,
  Circle,
  Loader2,
  Globe,
  Check,
  Copy,
  MoreHorizontal,
  Info,
  ExternalLink,
} from 'lucide-react'
import { useState, useEffect, useCallback, useRef } from 'react'
import { type z } from 'zod'

import { useConnection } from '@/hooks/use-connection'
import {
  type RemoteKernel,
  getRemoteKernels,
  addRemoteKernel,
  removeRemoteKernel,
} from '@/lib/remote-kernels'

import { AddRemoteDialog } from './add-remote-dialog'
import { CreateInstanceDialog } from './create-instance-dialog'

type KernelInstanceInfo = z.infer<typeof KernelInstanceInfoSchema>

const STATUS_COLORS: Record<string, string> = {
  ready: 'text-emerald-500',
  booting: 'text-yellow-500',
  stopping: 'text-yellow-500',
  rebooting: 'text-yellow-500',
  stopped: 'text-muted-foreground',
  registered: 'text-muted-foreground',
  failed: 'text-red-500',
  degraded: 'text-orange-500',
}

const CARD_BASE = 'group border rounded-lg p-3 min-h-[52px] transition-colors'

const STATUS_BORDER: Record<string, string> = {
  failed: 'border-red-500/40',
  booting: 'border-yellow-500/40',
  stopping: 'border-yellow-500/40',
  rebooting: 'border-yellow-500/40',
}

function CopyableUrl({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)
  const timeout = useRef<ReturnType<typeof setTimeout>>(undefined)

  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation()
    navigator.clipboard.writeText(url)
    setCopied(true)
    clearTimeout(timeout.current)
    timeout.current = setTimeout(() => setCopied(false), 1500)
  }

  return (
    <button
      onClick={handleCopy}
      className="group/copy inline-flex items-center gap-1 hover:text-foreground transition-colors"
      title="Copy URL"
    >
      <span>{url}</span>
      {copied ? (
        <Check className="w-3 h-3 text-emerald-500" />
      ) : (
        <Copy className="w-3 h-3 opacity-0 group-hover/copy:opacity-100 transition-opacity" />
      )}
    </button>
  )
}

function InstanceMenu({
  inst,
  actionLoading,
  onAction,
  onDelete,
}: {
  inst: KernelInstanceInfo
  actionLoading: string | null
  onAction: (method: 'boot' | 'stop' | 'reboot') => void
  onDelete: () => void
}) {
  const [open, setOpen] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const isActioning = (method: string) => actionLoading === `${inst.id}:${method}`
  const transitioning = ['booting', 'stopping', 'rebooting'].includes(inst.status)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  return (
    <div className="relative" ref={menuRef} onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-1">
        {['registered', 'stopped', 'failed'].includes(inst.status) && (
          <button
            onClick={() => onAction('boot')}
            disabled={!!actionLoading}
            className="p-1.5 rounded hover:bg-accent text-emerald-600 disabled:opacity-30"
            title="Boot"
          >
            {isActioning('boot') ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Play className="w-4 h-4" />
            )}
          </button>
        )}
        {transitioning && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
        {!transitioning && (
          <button
            onClick={() => onDelete()}
            disabled={!!actionLoading}
            className="p-1.5 rounded hover:bg-accent text-red-500 disabled:opacity-30"
            title="Delete"
          >
            {isActioning('delete') ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Trash2 className="w-4 h-4" />
            )}
          </button>
        )}
        <button
          onClick={() => setOpen((v) => !v)}
          className="p-1.5 rounded hover:bg-accent text-muted-foreground"
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
      </div>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-48 bg-background border rounded-lg shadow-lg py-1 text-sm">
          {['ready', 'degraded'].includes(inst.status) && (
            <>
              <button
                onClick={() => {
                  onAction('stop')
                  setOpen(false)
                }}
                disabled={!!actionLoading}
                className="flex items-center gap-2 w-full px-3 py-1.5 hover:bg-accent disabled:opacity-30 text-left"
              >
                <Square className="w-3.5 h-3.5" /> Stop
              </button>
              <button
                onClick={() => {
                  onAction('reboot')
                  setOpen(false)
                }}
                disabled={!!actionLoading}
                className="flex items-center gap-2 w-full px-3 py-1.5 hover:bg-accent disabled:opacity-30 text-left"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Reboot
              </button>
              <div className="border-t my-1" />
            </>
          )}
          <button
            onClick={() => {
              setShowDetails(true)
              setOpen(false)
            }}
            className="flex items-center gap-2 w-full px-3 py-1.5 hover:bg-accent text-left"
          >
            <Info className="w-3.5 h-3.5" /> Details
          </button>
        </div>
      )}

      {showDetails && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setShowDetails(false)}
        >
          <div
            className="bg-background border rounded-lg shadow-lg w-full max-w-sm p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-sm font-semibold mb-3">{inst.label || inst.id}</h2>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">ID</span>
                <span className="font-mono">{inst.id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Graph</span>
                <span className="font-mono">{inst.graphName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Status</span>
                <span className={STATUS_COLORS[inst.status] ?? ''}>{inst.status}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Internal URL</span>
                <span className="font-mono">
                  {inst.host}:{inst.port}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Proxy URL</span>
                <CopyableUrl url={`${window.location.host}/${inst.id}/ws`} />
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Created</span>
                <span>{new Date(inst.createdAt).toLocaleString()}</span>
              </div>
              {inst.bootedAt && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Booted</span>
                  <span>{new Date(inst.bootedAt).toLocaleString()}</span>
                </div>
              )}
              {inst.error && (
                <div className="mt-2 p-2 rounded bg-red-500/10 text-red-500">{inst.error}</div>
              )}
            </div>
            <div className="flex justify-end mt-4">
              <button
                onClick={() => setShowDetails(false)}
                className="px-3 py-1.5 text-sm rounded-md hover:bg-accent"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function InstanceCard({
  inst,
  actionLoading,
  onConnect,
  onAction,
  onDelete,
}: {
  inst: KernelInstanceInfo
  actionLoading: string | null
  onConnect: () => void
  onAction: (method: 'boot' | 'stop' | 'reboot') => void
  onDelete: () => void
}) {
  return (
    <div
      className={`${CARD_BASE} ${
        inst.status === 'ready' ? 'hover:border-primary/40 cursor-pointer' : ''
      } ${STATUS_BORDER[inst.status] ?? ''}`}
      onClick={onConnect}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <Circle
            className={`w-2.5 h-2.5 flex-shrink-0 fill-current ${STATUS_COLORS[inst.status] ?? 'text-muted-foreground'}`}
          />
          <div className="min-w-0">
            <span className="font-medium text-sm truncate">{inst.label || inst.id}</span>
            <div className="flex items-center mt-0.5 text-xs text-muted-foreground">
              <CopyableUrl url={`${window.location.host}/${inst.id}/ws`} />
            </div>
            {inst.error && <p className="text-xs text-red-500 mt-1 truncate">{inst.error}</p>}
          </div>
        </div>
        <div className="flex-shrink-0 ml-4 flex items-center gap-2">
          {inst.status === 'ready' && (
            <a
              href={`http://localhost:3400/kernel/${inst.id}`}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              title="Open shell demo for this instance"
            >
              Shell demo
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
          <InstanceMenu
            inst={inst}
            actionLoading={actionLoading}
            onAction={onAction}
            onDelete={onDelete}
          />
        </div>
      </div>
    </div>
  )
}

export function ManagerPage() {
  const [instances, setInstances] = useState<KernelInstanceInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [remoteKernels, setRemoteKernels] = useState<RemoteKernel[]>([])
  const [showAddRemote, setShowAddRemote] = useState(false)
  const [deleteRemoteConfirm, setDeleteRemoteConfirm] = useState<string | null>(null)
  const connection = useConnection()
  const navigate = useNavigate()

  const refresh = useCallback(async () => {
    if (connection.status !== 'connected' || !connection.manager) return
    try {
      const result = await connection.manager.static('KernelInstance').list({})
      setInstances(result ?? [])
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [connection.status, connection.manager])

  useEffect(() => {
    if (connection.status !== 'connected') return
    refresh()
    const interval = setInterval(refresh, 3000)
    return () => clearInterval(interval)
  }, [connection.status, refresh])

  async function action(id: string, method: 'boot' | 'stop' | 'reboot') {
    if (!connection.manager) return
    setActionLoading(`${id}:${method}`)
    try {
      await connection.manager.static('KernelInstance')[method]({ id })
      await refresh()
    } finally {
      setActionLoading(null)
    }
  }

  async function deleteInstance(id: string) {
    if (!connection.manager) return
    setActionLoading(`${id}:delete`)
    try {
      await connection.manager.static('KernelInstance').delete({ id })
      await refresh()
    } finally {
      setActionLoading(null)
      setDeleteConfirm(null)
    }
  }

  async function handleCreate(name: string) {
    if (!connection.manager) return
    const id = name
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
    await connection.manager.static('KernelInstance').register({
      id,
      graphName: id,
      label: name,
      host: 'localhost',
      port: 6379,
    })
    setShowCreate(false)
    // Auto-boot after creation
    try {
      await connection.manager.static('KernelInstance').boot({ id })
    } catch {
      // boot may fail, refresh will show the status
    }
    await refresh()
  }

  useEffect(() => {
    setRemoteKernels(getRemoteKernels())
  }, [])

  function handleAddRemote(name: string, url: string) {
    addRemoteKernel(name, url)
    setRemoteKernels(getRemoteKernels())
    setShowAddRemote(false)
  }

  function handleDeleteRemote(slug: string) {
    removeRemoteKernel(slug)
    setRemoteKernels(getRemoteKernels())
    setDeleteRemoteConfirm(null)
  }

  function connectToKernel(instance: KernelInstanceInfo) {
    if (instance.status !== 'ready') return
    navigate({ to: '/kernel/$id', params: { id: instance.id } })
  }

  if (connection.status !== 'connected') {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-background text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mb-3" />
        <p className="text-sm">Connecting to manager kernel...</p>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <div className="border-b px-6 py-4 flex items-center gap-3">
        <Server className="w-5 h-5 text-muted-foreground" />
        <h1 className="text-lg font-semibold">Kernel Instances</h1>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Local Instances */}
          <div className="border rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Server className="w-4 h-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold">Local</h2>
                <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                  {instances.length + 1}
                </span>
              </div>
              <button
                onClick={() => setShowCreate(true)}
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs border rounded-md hover:bg-accent transition-colors"
              >
                <Plus className="w-3 h-3" />
                New
              </button>
            </div>

            <div className="grid gap-2">
              {/* Manager instance — always present, no actions */}
              <div
                className={`${CARD_BASE} hover:border-primary/40 cursor-pointer`}
                onClick={() => navigate({ to: '/playground' })}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <Circle className="w-2.5 h-2.5 flex-shrink-0 fill-current text-emerald-500" />
                    <div className="min-w-0">
                      <span className="font-medium text-sm truncate">Manager</span>
                      <div className="flex items-center mt-0.5 text-xs text-muted-foreground">
                        <CopyableUrl url={`${window.location.host}/mngt/ws`} />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {loading && (
                <div className="flex items-center justify-center h-20 text-muted-foreground">
                  <Loader2 className="w-5 h-5 animate-spin mr-2" />
                  Loading...
                </div>
              )}

              {!loading && instances.length === 0 && (
                <div className="flex flex-col items-center justify-center h-20 text-muted-foreground">
                  <p className="text-xs">No other instances</p>
                </div>
              )}

              {!loading &&
                instances.map((inst) => (
                  <InstanceCard
                    key={inst.id}
                    inst={inst}
                    actionLoading={actionLoading}
                    onConnect={() => connectToKernel(inst)}
                    onAction={(method) => action(inst.id, method)}
                    onDelete={() => setDeleteConfirm(inst.id)}
                  />
                ))}
            </div>
          </div>

          {/* Remote Kernels */}
          <div className="border rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold">Remote</h2>
                <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                  {remoteKernels.length}
                </span>
              </div>
              <button
                onClick={() => setShowAddRemote(true)}
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs border rounded-md hover:bg-accent transition-colors"
              >
                <Plus className="w-3 h-3" />
                Add
              </button>
            </div>

            {remoteKernels.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
                <Globe className="w-8 h-8 mb-2 opacity-30" />
                <p className="text-sm">No remote kernels</p>
                <button
                  onClick={() => setShowAddRemote(true)}
                  className="mt-2 text-xs text-primary hover:underline"
                >
                  Add your first remote
                </button>
              </div>
            ) : (
              <div className="grid gap-2">
                {remoteKernels.map((remote) => (
                  <div
                    key={remote.slug}
                    className={`${CARD_BASE} hover:border-primary/40 cursor-pointer`}
                    onClick={() =>
                      navigate({ to: '/kernel/remote/$slug', params: { slug: remote.slug } })
                    }
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 min-w-0">
                        <Circle className="w-2.5 h-2.5 flex-shrink-0 fill-current text-muted-foreground" />
                        <div className="min-w-0">
                          <span className="font-medium text-sm truncate">{remote.name}</span>
                          <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                            <CopyableUrl url={remote.url} />
                          </div>
                        </div>
                      </div>
                      <div className="flex-shrink-0 ml-4" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => setDeleteRemoteConfirm(remote.slug)}
                          className="p-1.5 rounded hover:bg-accent text-red-500"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {showCreate && (
        <CreateInstanceDialog
          existingIds={instances.map((i) => i.id)}
          existingNames={instances.map((i) => i.label ?? i.id)}
          onSubmit={handleCreate}
          onClose={() => setShowCreate(false)}
        />
      )}
      {showAddRemote && (
        <AddRemoteDialog onSubmit={handleAddRemote} onClose={() => setShowAddRemote(false)} />
      )}

      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-background border rounded-lg shadow-lg w-full max-w-sm p-6">
            <h2 className="text-sm font-semibold mb-2">Delete Instance</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Are you sure you want to delete{' '}
              <span className="font-medium text-foreground">
                {instances.find((i) => i.id === deleteConfirm)?.label || deleteConfirm}
              </span>
              ? This will permanently destroy the associated graph data.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeleteConfirm(null)}
                disabled={!!actionLoading}
                className="px-3 py-1.5 text-sm rounded-md hover:bg-accent"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteInstance(deleteConfirm)}
                disabled={!!actionLoading}
                className="px-3 py-1.5 text-sm bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-30"
              >
                {actionLoading ? <Loader2 className="w-4 h-4 animate-spin inline mr-1" /> : null}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteRemoteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-background border rounded-lg shadow-lg w-full max-w-sm p-6">
            <h2 className="text-sm font-semibold mb-2">Delete Remote Kernel</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Are you sure you want to remove{' '}
              <span className="font-mono font-medium text-foreground">{deleteRemoteConfirm}</span>?
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeleteRemoteConfirm(null)}
                className="px-3 py-1.5 text-sm rounded-md hover:bg-accent"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDeleteRemote(deleteRemoteConfirm)}
                className="px-3 py-1.5 text-sm bg-red-600 text-white rounded-md hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
