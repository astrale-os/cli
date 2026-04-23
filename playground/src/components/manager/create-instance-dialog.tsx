import { X } from 'lucide-react'
import { useState } from 'react'

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

interface CreateInstanceDialogProps {
  existingIds: string[]
  existingNames: string[]
  onSubmit: (name: string) => void
  onClose: () => void
}

export function CreateInstanceDialog({
  existingIds,
  existingNames,
  onSubmit,
  onClose,
}: CreateInstanceDialogProps) {
  const [name, setName] = useState('')

  const slug = toSlug(name.trim())
  const nameTaken = existingNames.some((n) => n.toLowerCase() === name.trim().toLowerCase())
  const slugTaken = slug !== '' && existingIds.includes(slug)
  const hasError = nameTaken || slugTaken

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || hasError) return
    onSubmit(name.trim())
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-background border rounded-lg shadow-lg w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold">New Kernel Instance</h2>
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
              placeholder="My Kernel"
              className={`w-full px-3 py-1.5 text-sm border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring ${nameTaken ? 'border-red-500' : ''}`}
              required
              autoFocus
            />
            {nameTaken && <p className="text-xs text-red-500 mt-1">This name is already taken</p>}
          </div>

          <div>
            <label className="block text-xs text-muted-foreground mb-1">Slug</label>
            <input
              value={slug}
              disabled
              className={`w-full px-3 py-1.5 text-sm border rounded-md bg-muted text-muted-foreground font-mono focus:outline-none ${slugTaken ? 'border-red-500' : ''}`}
            />
            {slugTaken && !nameTaken && (
              <p className="text-xs text-red-500 mt-1">This slug is already taken</p>
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
              disabled={!name.trim() || hasError}
              className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:opacity-90 disabled:opacity-30"
            >
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
