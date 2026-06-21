import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster } from 'sonner'

import { App } from './app'
import { queryClient } from './lib/query'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <Toaster theme="dark" position="bottom-right" richColors closeButton />
    </QueryClientProvider>
  </StrictMode>,
)
