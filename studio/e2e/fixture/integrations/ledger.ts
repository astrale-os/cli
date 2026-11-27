import { defineIntegration } from '@astrale-os/sdk/integration'

/** The accounting ledger every Payment is recorded in. */
export const Ledger = defineIntegration({
  id: 'studio-demo.ledger',
  operations: {
    record: defineIntegration.operation<{ invoice: string; amount: number }, void>({
      replay: { kind: 'unsafe' },
    }),
  },
})
