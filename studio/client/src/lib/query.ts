import { QueryClient } from '@tanstack/react-query'

import { unreadableOf } from './api'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      refetchOnWindowFocus: false,
      // a state file not read whole stays so until it is fixed by hand: said at once, not retried
      retry: (failures, error) => failures < 1 && !unreadableOf(error),
    },
  },
})
