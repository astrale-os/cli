import { X } from 'lucide-react'
import { useState } from 'react'

import { getRemoteKernels, toSlug } from '@/lib/remote-kernels'

interface AddRemoteDialogProps {
  onSubmit: (name: string, url: string) => void
  onClose: () => void
}

function normalizeWsUrl(raw: string): string {
  const url = raw.trim()
  if (!url) return ''
  if (/^wss?:\/\//.test(url)) return url
  return `ws://${url}`
}

export function AddRemoteDialog({ onSubmit, onClose }: AddRemoteDialogProps) {
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')

  const existing = getRemoteKernels()
  const nameTaken = existing.some((k) => k.slug === toSlug(name.trim()))
  const normalizedUrl = normalizeWsUrl(url)
  const urlEmpty = !url.trim()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || urlEmpty || nameTaken) return
    onSubmit(name.trim(), normalizedUrl)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-background border rounded-lg shadow-lg w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold">Add Remote Kernel</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Remote Kernel"
              className={`w-full px-3 py-1.5 text-sm border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring ${nameTaken ? 'border-red-500' : ''}`}
              required
              autoFocus
            />
            {nameTaken && <p className="text-xs text-red-500 mt-1">This name is already taken</p>}
          </div>

          <div>
            <label className="block text-xs text-muted-foreground mb-1">URL</label>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="localhost:3001/my-kernel/ws"
              className="w-full px-3 py-1.5 text-sm border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring"
              required
            />
            {!urlEmpty && (
              <p className="mt-1 text-xs text-muted-foreground font-mono truncate">
                {normalizedUrl}
              </p>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-sm rounded-md hover:bg-accent"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim() || urlEmpty || nameTaken}
              className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:opacity-90 disabled:opacity-30"
            >
              Add
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
