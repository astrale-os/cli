/**
 * Main App Component
 */

import { useEndpoint, useReady, useWindow } from '@astrale/react'
import { useState } from 'react'

import type { WindowState } from '../state'
import type { Item } from '../types'

export function Main() {
  const ready = useReady()

  if (!ready) {
    return (
      <div style={styles.loading}>
        <h2>{{ APP_NAME }}</h2>
        <p>Connecting...</p>
      </div>
    )
  }

  return <AppContent />
}

function AppContent() {
  const { state, patch } = useWindow<WindowState>()
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')

  const { data, loading, refetch } = useEndpoint<{ items: Item[] }, { limit: number }>(
    'items.list',
    { limit: 20 },
  )

  const { mutate: createItem, loading: creating } = useEndpoint<
    { id: string },
    { title: string; content: string }
  >('items.create')

  const handleCreate = async () => {
    if (!title.trim()) return
    await createItem({ title: title.trim(), content: content.trim() })
    setTitle('')
    setContent('')
    refetch()
  }

  const items = data?.items ?? []

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>{{ APP_NAME }}</h2>

      <div style={styles.form}>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          style={styles.input}
        />
        <input
          type="text"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Content"
          style={styles.input}
        />
        <button onClick={handleCreate} disabled={creating} style={styles.button}>
          {creating ? 'Creating...' : 'Create'}
        </button>
      </div>

      <div style={styles.list}>
        {loading && <div style={styles.muted}>Loading...</div>}
        {items.map((item) => (
          <div
            key={item.id}
            onClick={() => patch({ selectedId: item.id })}
            style={{
              ...styles.item,
              ...(state.selectedId === item.id ? styles.itemSelected : {}),
            }}
          >
            <strong>{item.title}</strong>
            <p style={styles.itemContent}>{item.data.content}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  loading: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100vh',
    fontFamily: 'system-ui, sans-serif',
    color: '#888',
  },
  container: {
    padding: 20,
    fontFamily: 'system-ui, sans-serif',
    maxWidth: 600,
    margin: '0 auto',
  },
  title: {
    margin: '0 0 20px 0',
  },
  form: {
    display: 'flex',
    gap: 8,
    marginBottom: 20,
  },
  input: {
    flex: 1,
    padding: 8,
    borderRadius: 4,
    border: '1px solid #ccc',
  },
  button: {
    padding: '8px 16px',
    borderRadius: 4,
    border: 'none',
    background: '#0066cc',
    color: '#fff',
    cursor: 'pointer',
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  item: {
    padding: 12,
    borderRadius: 4,
    border: '1px solid #eee',
    cursor: 'pointer',
  },
  itemSelected: {
    background: '#f0f7ff',
    borderColor: '#0066cc',
  },
  itemContent: {
    margin: '4px 0 0 0',
    color: '#666',
    fontSize: 14,
  },
  muted: {
    color: '#888',
  },
}
