# Workflows

Read to write, migrate, test, call or deploy a Workflow. A durable Workflow runs on the Kernel's
workflow engine: it survives a crash, a redeploy or a wait of several days, never runs a finished
Step again, retries each Step within its own budget, and lets a caller follow, signal or cancel it.
The full reference ships in the `@astrale-os/sdk` package as `docs/durable-workflows.md`.

## Action or Workflow

| The operation… | Write |
| --- | --- |
| reads, then makes at most one effect, and answers at once | an Action (`runtime.md`) |
| makes two or more effects that cannot commit together | a durable Workflow |
| waits: a delay, a decision, a payment | a durable Workflow |
| must finish after a crash or a redeploy between two effects | a durable Workflow |

- An effect is a Mutation, or a state-changing Integration, dependency or Kernel call. Reads never
  make a Workflow, and two Mutations that can commit together are one Mutation.
- The Schema decides whether a Workflow is durable, with `execution: { durable: true }` on its
  method. Without it, the Workflow runs inline, inside the request: the caller gets the output in
  the response, but a failure leaves the effects already made, and nothing resumes, retries or
  compensates them. Declare a Workflow durable unless its caller needs the output in the response.
- A durable callable needs `auth: 'authenticated'` or `'authorized'`, a value input and output (no
  binary, no stream), and a remote binding. It never runs inline.
- A caller receives `ExecutionRef<Output>` at once, not the output: design the caller to follow the
  run (see Callers).

## Write one

```ts
// schema: in the Invoice Class
remind: method({
  auth: 'authenticated',
  input: z.object({ note: z.string() }),
  output: z.object({ paid: z.boolean() }),
  execution: { durable: true },
}),
confirmPayment: method({
  auth: 'authorized',
  policy: canConfirmPayment,
  input: z.object({ amount: z.number() }),
  output: z.null(),
}),
```

```ts
// functions/invoice/remind.ts: record, notify, then wait three days for the payment
export const remind = defineWorkflow<typeof schema, typeof integrations>()(
  'Invoice.remind',
  async ({ input, self, execution, step, awaitSignal }) => {
    await step.mutate('record-reminder', recordReminder, {
      invoice: self,
      note: input.note,
      execution: execution.id, // lets confirmPayment find this run
    })

    await step.parallel((s) => [
      s.run({ id: 'send-email', retry: { maxAttempts: 5 }, timeoutMs: 30_000 }, ({ integrations }) =>
        integrations.mailer.send({ invoice: self, template: 'reminder' }),
      ),
      s.run('log-to-crm', ({ integrations }) => integrations.crm.logReminder({ invoice: self })),
    ])

    const payment = await awaitSignal<{ readonly amount: number }>('paid', {
      timeoutMs: 3 * 24 * 3_600_000,
    })
    if (payment.kind === 'timeout') {
      await step.mutate('flag-overdue', flagOverdue, { invoice: self })
      return { paid: false }
    }
    await step.mutate('record-payment', recordPayment, { invoice: self, amount: payment.value.amount })
    return { paid: true }
  },
)

// functions/invoice/confirm-payment.ts: the business method that wakes the run
export const confirmPayment = defineAction<typeof schema>()(
  'Invoice.confirmPayment',
  async ({ input, self, query, kernel }) => {
    const reminder = await query(pendingReminderOf, { invoice: self })
    await kernel.execution.signal(reminder.execution, { name: 'paid', value: { amount: input.amount } })
    return null
  },
)
```

Register it in `functions/` like any Action. The build serves the workflow engine as soon as the
Schema declares a durable callable; there is nothing else to wire.

## The context

| Member | Use |
| --- | --- |
| `input`, `self`, `domain`, `error` | As in an Action. |
| `step.query(id, query, input)` | One read, recorded: a resumed run reuses its result. |
| `step.mutate(id, mutation, input)` | One Mutation, keyed: a retry never writes twice. |
| `step.run(id, (capabilities) => …)` | Any other call. The callback receives `query`, `mutate`, `kernel`, `graph`, `dependencies` and `integrations`, acting with the identity of the function (its Domain). |
| `step.parallel((s) => [...])` | Independent Steps in one engine round trip; `s` takes the arguments of `step.*`. |
| `sleep(ms)` | A durable timer, kept while the Domain is down. |
| `awaitSignal(name, { timeoutMs? })` | Waits for a signal; with `timeoutMs`, answers `{ kind: 'signal', value }` or `{ kind: 'timeout' }`. |
| `exhausted(error)`, `cancelled(error)` | Recognize a Step that spent its budget, or a cancellation, in a `catch`. |
| `retryAfter(ms, cause?)` | Thrown inside a Step: the next attempt waits `ms` (at most one hour). |
| `execution` | Facts on the run: `id` (record it in the graph), `function`, `kernel`, `initiator`, `receiver`. Data, never authority. |

The context has no `query`, `mutate`, `kernel`, `graph`, `dependencies`, `integrations` or
`caller`: the Kernel is reachable only inside a Step, and the run never acts as its caller. Any
`step` argument may be `{ id, retry, timeoutMs }` instead of an id.

## Steps

A finished Step is never run again: a resumed run takes its recorded result and continues. The
code between Steps runs again on every resume. Every rule below follows from that.

- **One effect per Step.** When a second effect fails, the Workflow must know whether the first one
  committed. `FNC-EFFECT-STEP` warns on a Step that can make two.
- **Read in an earlier Step than the effect.** An effect Step builds its request only from the
  input and earlier Step results. A Step retried after its write committed would otherwise read its
  own write, build another request, and be refused on every attempt. `FNC-STEP-READS` reports it.

  ```ts
  // wrong: the read and the effect share one Step
  await step.run('record', async ({ query, mutate }) => {
    const sent = await query(remindersOf, { invoice: self })
    return mutate(recordReminder, { invoice: self, rank: sent.length + 1 })
  })

  // right
  const sent = await step.query('count-reminders', remindersOf, { invoice: self })
  await step.mutate('record', recordReminder, { invoice: self, rank: sent.length + 1 })
  ```

- **Refuse inside the Step.** A business refusal a Step detects is `throw error(code, details)`
  inside that Step: the Execution ends `failed` with that code, without retry. Any other error is
  retried until the Step spends its budget, and the Execution ends `STEP_EXHAUSTED` instead.
- **Keep the code between Steps deterministic.** Read the clock, randomness and generated ids
  inside a Step. `FNC-REPLAY-VALUES` warns on the clock and randomness (`Date.now()`, `new Date()`,
  `Math.random()`, `crypto.randomUUID()`…) read outside one.
- **Await one thing at a time, or use `step.parallel`.** Never combine Steps or waits with
  `Promise.all`, `allSettled`, `race` or `any`: a Step or wait started while another runs is refused,
  which pauses the run. `step.parallel` settles every Step, then returns their outputs in order or
  throws the first failure: keep in sequence the effects a failure would make you compensate.
  Independent reads may also share one Step, where `Promise.all` over its Kernel calls is fine.
- **Steps never nest.** A helper that receives `query` or `mutate` runs inside a Step, with that
  Step's capabilities. A helper that opens Steps receives the durable `step` and reads through
  `step.query`.
- **A Step per effect, not per item.** Each Step awaited alone costs one engine round trip. Write a
  collection in one Mutation, run items with `step.parallel`, or hand them to another durable call.
- **Stable, unique ids; portable results.** Runs in flight replay by Step id and order. Return plain
  values, never clients, responses or other live objects.
- **A fact that must hold at commit is a precondition.** A recorded read is the value when its Step
  ran. Use `mutation.expect` and map `MUTATION_PRECONDITION_FAILED` to a declared error.

## What a retried Step repeats

| Call inside a Step | On a retry |
| --- | --- |
| Mutation | Carries a key derived from the run and the Step: the Kernel answers with the first result. |
| Durable callable of a dependency (`dependencies.x.self.invoke`) | Keyed too: the retry reaches the same child Execution. |
| Any other callable | Runs again: make it idempotent, or declare it durable. `FNC-STEP-RETRY` warns. |
| Integration operation `keyed`, source `execution` | The Provider receives the same `idempotencyKey` on every attempt. |
| Integration operation `safe` | Runs again. |
| Integration operation that may be `unsafe` | Absent from `integrations` inside a Step. |

### Call an external system

Declare the operation `keyed` so every attempt carries the same key. Give the Step its own budget,
honor `429`, and take a fallback path when the budget is spent:

```ts
export const Payments = defineIntegration({
  id: 'payments.billing.example',
  operations: {
    charge: defineIntegration.operation<ChargeRequest, ChargeAnswer>({
      replay: { kind: 'keyed', source: 'execution' },
    }),
  },
})

export const collect = defineWorkflow<typeof schema, typeof integrations>()(
  'Invoice.collect',
  { errors: { CHARGE_FAILED: chargeFailed } },
  async ({ input, self, step, retryAfter, exhausted, error }) => {
    let receipt: string
    try {
      receipt = await step.run(
        { id: 'charge', retry: { maxAttempts: 10, maxDurationMs: 6 * 3_600_000 }, timeoutMs: 30_000 },
        async ({ integrations }) => {
          const answer = await integrations.payments.charge({ invoice: self, amount: input.amount })
          if (answer.kind === 'throttled') throw retryAfter(answer.retryAfterMs)
          return answer.receipt
        },
      )
    } catch (cause) {
      if (!exhausted(cause)) throw cause
      await step.mutate('flag-unpaid', flagUnpaid, { invoice: self })
      throw error('CHARGE_FAILED', { invoice: self })
    }
    await step.mutate('record-charge', recordCharge, { invoice: self, receipt })
    return { charged: true }
  },
)
```

The Provider receives the key as `idempotencyKey` in its second argument and forwards it, for
instance as the service's `Idempotency-Key` header. `integrations.md` covers the contract and its
Provider.

### Call another Domain

Inside a Step, `dependencies.<alias>.self.invoke(...)` of a durable callable returns its
`ExecutionRef` and, keyed by the Step, reaches the same child on a retry. A Workflow does not wait
for another Execution's outcome: record the reference in the graph, and let the business flow
continue from there (a signal, a later call). From an Action, pass the key yourself:
`dependencies.billing.caller.invoke(ref, receiver, input, { idempotencyKey })`.

## Waits and signals

- `sleep` and `awaitSignal` are kept by the engine: the Domain may stop, redeploy or crash meanwhile.
- A signal is delivered once per name. One sent before the wait is kept for it; a second one with
  the same name is refused.
- A signal comes from a business method of the owner Domain, under that method's Policy, as
  `confirmPayment` does above: the run's caller can never signal or resume its own Execution. Record
  `execution.id` in the graph so the method can find the run.
- Signals are not typed: the Kernel checks neither name nor value, and a name no run awaits is never
  read. Type the value at the `awaitSignal` and validate it if it comes from input.
- Race a signal against time only through `awaitSignal(name, { timeoutMs })`, never `Promise.race`.
- A Workflow waits on nothing else: no graph event and no other Execution. The Domain that observes
  the event sends the signal.

## Retries, failures and outcomes

- Each Step runs under the deployment's budget unless it declares its own: by default 20 attempts,
  backoff from 1 s to 60 s, 60 s per attempt. A Step overrides it with
  `{ id, retry: { maxAttempts, maxDurationMs, initialIntervalMs, maxIntervalMs }, timeoutMs }`;
  `timeoutMs` runs from one second to ten minutes.
- Set the deployment's defaults with the Environment's `durable` option in `astrale.config.ts`
  (`retentionMs`, `retry`, `stepTimeoutMs`). They are frozen into the deployment: changing them
  makes a new deployment, and running runs keep the old values.
- A Step that spends its budget throws into the Workflow. Catch it with `exhausted(cause)` to take
  another path; uncaught, the Execution ends `failed` with `STEP_EXHAUSTED`, and
  `details: { step, refusal?: { code, reason? } }` names the Step and the Kernel refusal, if any.
- A Kernel refusal that prescribes a delay waits that delay instead of the backoff, as `retryAfter`
  does.
- A declared `error(...)` ends the Execution `failed` with that code. A failed Execution is never
  resumed; a new attempt is a new call.
- A failure outside any Step (an error between Steps, a journal the code no longer replays, an
  output the Schema refuses) retries the whole run up to `maxAttempts`, then pauses it. `resume`
  attempts it again with the code served at its URL, so it helps when the cause was transient;
  otherwise the owner Domain ends it with `cancel({ force: true })`, without compensation.
- The outcome is kept for the retention (7 days by default). Write anything needed later into the
  graph from a Step.

## Cancellation and compensation

Cancel is cooperative: the Workflow sees it at its next wait or Step, as an error `cancelled`
recognizes. Compensate with Steps, then rethrow to end `cancelled`, or return a value to end
`completed`.

```ts
const hold = await step.mutate('hold-stock', holdStock, { order: self, lines: input.lines })
try {
  await awaitSignal('approved')
} catch (cause) {
  if (!cancelled(cause)) throw cause
  await step.mutate('release-stock', releaseStock, { hold })
  throw cause
}
await step.mutate('confirm-order', confirmOrder, { order: self, hold })
```

A forced cancel (`cancel({ force: true })`, owner Domain only) ends the run at once, without
compensation; external effects stay.

## Callers

| Operation | View (`@astrale-os/shell-react`) | CLI | Client session | Who |
| --- | --- | --- | --- | --- |
| Start | `useAction(callable).run(…)` | `astrale call` | `session.invoke` | The callable's Policy |
| Follow | `useExecution(ref)` | `astrale execution status`, `result --wait` | `execution.status`, `execution.result` | Initiator, owner Domain |
| Cancel | | `astrale execution cancel` | `execution.cancel(ref)` | Initiator, owner Domain |
| Signal | | `astrale execution signal` | `execution.signal(ref, { name, value })` | Owner Domain, Root |
| Resume a pause | | `astrale execution resume` | `execution.resume(ref)` | Owner Domain, Root |
| Force cancel, delete | | | `execution.cancel(ref, { force: true })`, `execution.delete(ref)` | Owner Domain, Root |

The owner Domain reaches these from any of its handlers through `kernel.execution`.

```tsx
// A View refreshes when the run ends, not when the call returns
const billing = useDomain(Billing)
const remind = useAction(billing.domain.classes.Invoice.methods.remind, { refresh: 'none' })
const run = useExecution(remind.result) // { state, outcome, value, error, pending }
// remind.run({ id: invoice }, { note: 'J+30' })
```

```sh
astrale call '@<invoice>::billing.example:class.Invoice.method.remind' note=J+30 --wait
# exit 1: the run failed; exit 75: still running when the wait ended
astrale call '@<invoice>::billing.example:class.Invoice.method.remind' note=J+30 --json > receipt.json
astrale execution result receipt.json --wait
```

```ts
// remind: the callable's reference on the invoice
const run = await session.invoke(remind, { note: 'J+30' }, { idempotencyKey: 'remind:inv-0042:J+30' })
const outcome = await session.execution.result(run, { waitMs: 30_000 }) // typed by the reference
```

Give a client call an `idempotencyKey` when the caller may retry it: the same key returns the same
Execution (`replayed: true`) instead of starting another.

## Test

`createTestWorkflowEngine` from `@astrale-os/sdk/testing` runs the Workflow in memory with the
receiver a Host serves; only the engine is simulated. Timers follow a virtual clock.

```ts
const engine = createTestWorkflowEngine()
const options = {
  schema: Billing,                              // the resolved Schema
  input: { note: 'J+30' },
  self: invoice,
  capabilities: { mutate: () => null },         // answers the Steps' Queries and Mutations
  providers: { mailer: testMailer, crm: testCrm },
}

// a crash right after the reminder is written, then the payment
const paid = await engine.start(remind, { ...options, interruptAfter: ['record-reminder'] })
await paid.signal('paid', { amount: 1_200 })
expect(paid.outcome).toEqual({ kind: 'completed', value: { paid: true } })
await paid.replay() // fails if a resume would run a Step again or take another path

// three days without payment
const overdue = await engine.start(remind, options)
await engine.advance(3 * 24 * 3_600_000)
expect(overdue.outcome).toEqual({ kind: 'completed', value: { paid: false } })
```

For each Workflow, prove that:

- each business refusal ends `failed` with its declared code, not `STEP_EXHAUSTED`
  (`outcome`, and `failure` for what the last attempt threw);
- each effect survives `interruptAfter` on its Step without a second write;
- each scenario passes `replay()`;
- each wait has a scenario where it times out (`advance`), and each cancel point compensates
  (`cancel`).

These tests prove the Workflow against replay, not crash recovery on a Host: run one live call with
`astrale call … --wait` before claiming delivery.

## Deploy and evolve

A run finishes on the code of the deployment that started it.

| Change | Running runs | Do |
| --- | --- | --- |
| New release installed | Finish on the old deployment; new calls start on the new one. Each deployment is its own issuer: the old one keeps calling the Kernel for its runs for 7 days at most, then their Kernel calls are refused. A run that only waits is unaffected. | Keep the old deployment served until its runs end (`adapter-astrale` gives each release its own URL). Keep runs that call the Kernel under 7 days. `--revoke-previous` at install cuts the old deployment, its runs included, at once. |
| Code redeployed at the same URL | Resume with the new code; a renamed, moved or removed Step pauses them. | Avoid. Otherwise keep existing Steps in place, then `resume` the paused runs. |
| Class, Function or Edge removed or narrowed | A Step that still uses it is refused, then ends `STEP_EXHAUSTED`. | Keep the Schema additive; remove once no run uses it. |
| Deployment retired | Its runs stop progressing. | Retire a deployment once its runs have ended. |
| Durable callable removed | The Kernel cancels its runs within minutes, without compensation. | Remove a callable once its runs have ended. |

## Migrate an existing Workflow

1. Add `execution: { durable: true }` to its callable.
2. Move every Kernel call into a Step: reads become `step.query`, writes `step.mutate`, anything else
   `step.run(id, ({ query, mutate, kernel, integrations, dependencies }) => …)`. Drop `caller`.
3. Fix what the typecheck reports: each member the durable context lacks, and each caller that
   reads the output (it now receives `ExecutionRef<Output>`).
4. Check the three changes the typecheck cannot see: refusals thrown as `error(...)` inside their
   Step, clock and randomness read inside a Step, and callers that refresh after the call now
   follow the Execution (`useExecution`).
5. Run `astrale-domain lint`, then the tests above.

```ts
// before
async ({ input, self, query, mutate, integrations, step, error }) => {
  const invoice = await step.run('read-invoice', () => query(invoiceOf, { invoice: self }))
  if (invoice.balance > 0) throw error('OPEN_BALANCE', { invoice: self })
  await step.run('archive', () => mutate(markArchived, { invoice: self, reason: input.reason }))
  await step.run('notify', () => integrations.mailer.send({ invoice: self, template: 'archived' }))
  return null
}

// after
async ({ input, self, step, error }) => {
  const invoice = await step.query('read-invoice', invoiceOf, { invoice: self })
  if (invoice.balance > 0) throw error('OPEN_BALANCE', { invoice: self })
  await step.mutate('archive', markArchived, { invoice: self, reason: input.reason })
  await step.run('notify', ({ integrations }) =>
    integrations.mailer.send({ invoice: self, template: 'archived' }),
  )
  return null
}
```

## Limits

- A run starts only from a call: no schedule, no trigger on a graph event.
- A run waits only on a timer or a signal (see Waits and signals).
- A Domain cannot list its Executions: record each `execution.id` it needs in the graph.
- No manual pause: `resume` only continues a run the engine paused.
- A paused Execution's status gives no cause; read the Domain's logs.
- The run acts with the identity of the function (its Domain), never its caller; the callable's
  Policy is checked once, at the call.
