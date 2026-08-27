import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster } from 'sonner'

import { App } from './app'
import { queryClient } from './lib/query'
import { useUI } from './lib/store'
import './styles.css'

function ThemedToaster() {
  const theme = useUI((state) => state.resolvedTheme)
  return <Toaster theme={theme} position="bottom-right" richColors closeButton />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <ThemedToaster />
    </QueryClientProvider>
  </StrictMode>,
)
