import { createFileRoute } from '@tanstack/react-router'

import { ManagerPage } from '@/components/manager/manager-page'

export const Route = createFileRoute('/')({
  component: ManagerPage,
})
