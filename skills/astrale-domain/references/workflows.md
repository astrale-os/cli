# Workflows

A durable Workflow runs on the Kernel's workflow engine: it survives a crash, a redeploy or a
multi-day wait, never reruns a finished Step, retries each Step within its own budget, and can be
followed, signalled or cancelled. Full reference: `docs/durable-workflows.md` in `@astrale-os/sdk`.

## Action or Workflow

| The operation | Write |
| --- | --- |
| reads, then makes at most one effect, answers at once | an Action (`actions.md`) |
| makes ≥ 2 effects that cannot commit together | a durable Workflow |
| waits: a delay, a decision, a payment | a durable Workflow |
| must finish after a crash or redeploy between two effects | a durable Workflow |

- Effect = a Mutation, or a state-changing Integration, dependency or Kernel call. Reads never make
  a Workflow; two Mutations that can commit together are one Mutation.
- Durability is Schema-declared: `execution: { durable: true }` on the method. Without it the
  Workflow is inline (legacy): the Action context plus a `step.run` that records nothing; a failure
  leaves earlier effects, with no resume, retry or compensation. Write no new one (Migrate an
  inline Workflow).
- A durable callable needs `auth: 'authenticated' | 'authorized'`, value input and output (no
  binary, no stream), and a remote binding; it never runs inline. `defineAction` refuses it.
- Cost: N sequential Steps = N + 2 engine → Domain requests, each replaying the journal so far; an
  Action is one request. The caller gets `ExecutionRef<Output>`, not the output, and follows the
  Execution (Callers). The run acts as its Domain only, never as its caller. A user waiting on
  screen calls an Action unless effects truly need coordination.

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
    await step.mutate(
      'record-reminder',
      recordReminder,
      { invoice: self, note: input.note, execution: execution.id }, // lets confirmPayment find this run
      { as: 'executor' },
    )

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
      await step.mutate('flag-overdue', flagOverdue, { invoice: self }, { as: 'executor' })
      return { paid: false }
    }
    await step.mutate(
      'record-payment',
      recordPayment,
      { invoice: self, amount: payment.value.amount },
      { as: 'executor' },
    )
    return { paid: true }
  },
)

// functions/invoice/confirm-payment.ts: the business method that wakes the run
export const confirmPayment = defineAction<typeof schema>()(
  'Invoice.confirmPayment',
  async ({ input, self, query, kernel }) => {
    const reminder = await query(pendingReminderOf, { invoice: self }, { as: 'executor' })
    await kernel.execution.signal(reminder.execution, { name: 'paid', value: { amount: input.amount } })
    return null
  },
)
```

Registered in `functions/` like an Action; the build serves the engine once the Schema declares a
durable callable, with nothing else to wire.

## The context

| Member | Semantics |
| --- | --- |
| `input`, `self`, `domain`, `error` | As in an Action |
| `step.query(id, definedQuery, input, { as: 'executor' })` | One journaled Query; a resumed run reuses its result |
| `step.mutate(id, definedMutation, input, { as: 'executor' })` | One keyed Mutation; a retry never writes twice |
| `step.run(id, (capabilities) => …)` | Any other call; `capabilities` = `query`, `mutate`, `kernel`, `graph`, `dependencies`, `integrations`, as the executor |
| `step.parallel((s) => [...])` | Independent Steps in one engine round trip; `s` takes the arguments of `step.*` |
| `sleep(ms)` | Durable timer, kept while the Domain is down |
| `awaitSignal(name, { timeoutMs? })` | With `timeoutMs`: `{ kind: 'signal', value } \| { kind: 'timeout' }` |
| `exhausted(error)`, `cancelled(error)` | In a `catch`: a Step that spent its budget or was refused for good; a cancellation |
| `retryAfter(ms, cause?)` | Thrown in a Step: next attempt waits `ms` (≤ 1 h); spends an attempt |
| `execution` | `id` (record it in the graph), `function`, `kernel`, `initiator`, `receiver`: data, never authority |

No `query`, `mutate`, `kernel`, `graph`, `dependencies`, `integrations` or `caller` outside a Step:
the Kernel is reachable only inside one. Any `step` id argument may be `{ id, retry, timeoutMs }`.

## Steps

A finished Step never reruns: a resume takes its journaled result. Code between Steps reruns on
every resume. Hence:

- **One effect per Step.** After a second effect fails, the Workflow must know whether the first
  committed. `FNC-EFFECT-STEP` warns on a Step that can make two, or repeat one in a loop.
- **Read in an earlier Step than the effect.** An effect Step builds its request only from the
  input and earlier Step results. Retried after its write committed, a Step that read first sees
  its own write, builds another request, and is refused `MUTATION_IDEMPOTENCY_CONFLICT` on every
  attempt. `FNC-STEP-READS` reports it.

  ```ts
  // wrong: the read and the effect share one Step
  await step.run('record', async ({ query, mutate }) => {
    const sent = await query(remindersOf, { invoice: self }, { as: 'executor' })
    return mutate(recordReminder, { invoice: self, rank: sent.length + 1 }, { as: 'executor' })
  })

  // right
  const sent = await step.query('count-reminders', remindersOf, { invoice: self }, { as: 'executor' })
  await step.mutate('record', recordReminder, { invoice: self, rank: sent.length + 1 }, { as: 'executor' })
  ```

- **Refuse inside the Step.** `throw error(code, details)` inside the Step that detects it ends the
  Execution `failed` with that code, no retry. Any other error retries until the budget is spent,
  then the Execution ends `STEP_EXHAUSTED`.
- **Deterministic code between Steps.** Read the clock, randomness and generated ids inside a Step.
  `FNC-REPLAY-VALUES` warns on `Date.now()`, `new Date()`, `Math.random()`, `crypto.randomUUID()`
  outside one, Step-call arguments included.
- **No `Promise.all`, `allSettled`, `race`, `any` over Steps or waits.** A Step or wait started while
  another runs throws a `TypeError`, which pauses the run. `step.parallel` settles every Step, then
  returns outputs in order or throws the first failure in declaration order; the others' effects
  stand. Keep in sequence the effects a failure would make you compensate. Independent reads may
  share one Step, inside which `Promise.all` over Kernel calls is fine.
- **Steps never nest.** A helper receiving `query`/`mutate` runs inside a Step; a helper opening
  Steps receives `step`.
- **A Step per effect, not per item.** Each Step awaited alone is one engine round trip: write a
  collection in one Mutation, run items with `step.parallel`, or hand them to another durable call.
- **Stable unique ids, portable results.** In-flight runs replay by Step id and order. Return plain
  values, never clients, responses or live objects.
- **A journaled read is the value when its Step ran.** A fact that must hold at commit is a
  `mutation.expect` guard; map `MUTATION_PRECONDITION_FAILED` to a declared error.

## What a retried Step repeats

| Call inside a Step | On a retry |
| --- | --- |
| Mutation | Keyed by the Execution, the Step and its position: the Kernel answers the first result |
| Durable callable (`kernel.invoke`, `dependencies.x.self.invoke`) | Keyed: reaches the same child Execution, answers its `ExecutionRef` |
| Any other callable | Runs again: make it idempotent or declare it durable. `FNC-STEP-RETRY` warns (also on an untyped Path, `fetch`) |
| Integration operation `keyed`, source `execution` | Same `idempotencyKey` on every attempt |
| Integration operation `keyed`, source `input` | The key the decision takes from the input |
| Integration operation `safe` | Runs again |
| Integration operation that may be `unsafe` | Absent from `integrations` inside a Step |

### Call an external system

Declare the operation `keyed`, give the Step its own budget, honor `429`, take a fallback path when
the budget is spent:

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
      await step.mutate('flag-unpaid', flagUnpaid, { invoice: self }, { as: 'executor' })
      throw error('CHARGE_FAILED', { invoice: self })
    }
    await step.mutate('record-charge', recordCharge, { invoice: self, receipt }, { as: 'executor' })
    return { charged: true }
  },
)
```

The Provider receives the key as `idempotencyKey` (second argument) and forwards it, e.g. as an
`Idempotency-Key` header (`integrations.md`).

### Call another Domain

In a Step, `dependencies.<alias>.self.invoke(...)` of a durable callable returns its `ExecutionRef`,
keyed by the Step. A Workflow never awaits another Execution's outcome: record the reference in the
graph and continue the business flow from a signal or a later call. From an Action, pass the key:
`dependencies.billing.caller.invoke(ref, receiver, input, { idempotencyKey })`.

## Waits and signals

- `sleep` and `awaitSignal` are engine-kept: the Domain may stop, redeploy or crash meanwhile.
- One delivery per signal name. A signal sent before the wait is kept for it; a second with the
  same name is refused.
- A signal comes from a business method of the owner Domain, under that method's Policy
  (`confirmPayment` above): the run's caller cannot signal or resume its own Execution. Record
  `execution.id` in the graph so the method finds the run.
- Signals are untyped: the Kernel checks neither name nor value; a name no run awaits is never
  read. Type the value at `awaitSignal`; validate it when it comes from input.
- Race a signal against time only with `awaitSignal(name, { timeoutMs })`.
- A run waits on nothing else: no graph event, no other Execution. The Domain observing the event
  sends the signal.

## Retries, failures and outcomes

| Budget | Default | Override |
| --- | --- | --- |
| Step attempts | 10, backoff 1 s → 60 s, no duration limit | `retry: { maxAttempts (1–1,000), maxDurationMs, initialIntervalMs, maxIntervalMs }` |
| Step attempt timeout | 60 s, Kernel calls included | `timeoutMs`, 1 s to 10 min |
| Run attempts failing outside any Step | 20, then the run pauses | the deployment's `retry.maxAttempts` |
| Outcome retention | 7 days | `retentionMs` |

Deployment defaults: the Environment's `durable` option in `astrale.config.ts` (`retentionMs`,
`retry`, `stepTimeoutMs`), frozen into the deployment; a change makes a new deployment and running
runs keep the old values. A Step declaring `maxAttempts` or `maxDurationMs` replaces both.

- Attempts are spent only by the Step's own failures: its code, a Provider, a deadline,
  `retryAfter`, a Kernel refusal not listed below.
- Spent nothing, waited out for as long as the outage lasts (each wait = max(prescribed delay,
  backoff)): an unavailable Kernel, a refusal prescribing a delay (capacity, draining, maintenance),
  a Query or keyed call that gets no answer. Only `maxDurationMs` or a cancel bounds that wait:
  declare `maxDurationMs` when the business has a deadline. An attempt that ran an unkeyed `invoke`
  spends an attempt even on an outage.
- Fails the Step at once: a request the Kernel never accepts (malformed, invalid, method not allowed
  or unsupported, a stale expectation or callable fingerprint).
- A Step that spends its budget or fails at once throws into the Workflow; catch with
  `exhausted(cause)`. Uncaught: `failed`, `STEP_EXHAUSTED`,
  `details: { step, refusal?: { code, reason? } }`.
- A declared `error(...)` ends `failed` with its code. A failed Execution never resumes; retrying is
  a new call.
- A failure outside any Step (an error between Steps, a journal the code no longer replays, an
  output the Schema refuses, a deployment that does not answer) retries the whole run, then pauses
  it. `resume` reattempts with the code served at its URL (useful when the cause was transient);
  otherwise cancel.
- Anything needed after retention is written into the graph from a Step.

## Cancellation and compensation

Cancel is cooperative: the Workflow sees it at its next wait or Step as an error `cancelled`
recognizes. Compensate with Steps, then rethrow (`cancelled`) or return (`completed`).

```ts
const executor = { as: 'executor' } as const
const hold = await step.mutate('hold-stock', holdStock, { order: self, lines: input.lines }, executor)
try {
  await awaitSignal('approved')
} catch (cause) {
  if (!cancelled(cause)) throw cause
  await step.mutate('release-stock', releaseStock, { hold }, executor)
  throw cause
}
await step.mutate('confirm-order', confirmOrder, { order: self, hold }, executor)
```

A run that never reaches a wait or a Step (it fails outside any Step on every attempt, or its
deployment no longer answers) cannot compensate: a cancel ends it once its run attempts are spent.
`cancel({ force: true })` (owner Domain, Root, `execution.terminator`) ends any run at once. Both end
it without compensation; external effects stay.

## Callers

| Operation | View (`@astrale-os/shell-react`) | CLI | Client session | Who |
| --- | --- | --- | --- | --- |
| Start | `useAction(callable).run(…)` | `astrale call` | `session.invoke` | The callable's Policy |
| Follow | `useExecution(ref)` | `astrale execution status`, `result --wait` | `execution.status`, `execution.result` | Initiator, owner Domain, Root, `execution.reader` |
| Cancel | | `astrale execution cancel` | `execution.cancel(ref)` | Initiator, owner Domain, Root, `execution.terminator` |
| Signal | | `astrale execution signal` | `execution.signal(ref, { name, value })` | Owner Domain, Root |
| Resume a pause | | `astrale execution resume` | `execution.resume(ref)` | Owner Domain, Root |
| Force cancel, delete | | | `execution.cancel(ref, { force: true })`, `execution.delete(ref)` | Owner Domain, Root, `execution.terminator` |

`execution.reader` and `execution.terminator` are Kernel Roles (`policies.md`); no Role signals or
resumes. The owner Domain reaches all of these from any handler through `kernel.execution`.

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

A client call the caller may retry takes an `idempotencyKey`: the same key returns the same
Execution (`replayed: true`).

## Test

`createTestWorkflowEngine` (`@astrale-os/sdk/testing`) runs the Workflow in memory against the
receiver a Host serves; only the engine is simulated, on a virtual clock.

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

Prove per Workflow:

- each business refusal ends `failed` with its declared code, not `STEP_EXHAUSTED` (`outcome`;
  `failure` holds what the last attempt threw);
- each effect survives `interruptAfter` on its Step without a second write;
- each scenario passes `replay()`;
- each wait times out in one scenario (`advance`); each cancel point compensates (`cancel`).

This proves replay, not crash recovery on a Host: run one live `astrale call … --wait` before
claiming delivery.

## Deploy and evolve

A run finishes on the code of the deployment that started it.

| Change | Running runs | Do |
| --- | --- | --- |
| New release installed | Finish on the old deployment; new calls start on the new one. Each deployment is its own issuer: the old one keeps calling the Kernel for its runs for 7 days at most, then their Kernel calls are refused. A run that only waits is unaffected. | Keep the old deployment served until its runs end (`adapter-astrale` gives each release its own URL). Keep runs that call the Kernel under 7 days. `--revoke-previous` at install cuts the old deployment and its runs at once. |
| Code redeployed at the same URL | Resume on the new code; a renamed, moved or removed Step pauses them | Avoid. Otherwise keep existing Steps in place, then `resume` the paused runs |
| Class, Function or Edge removed or narrowed | A Step still using it is refused, then `STEP_EXHAUSTED` | Keep the Schema additive; remove once no run uses it |
| Deployment retired | Runs stop; their signals time out; a cancel ends them without compensation | Retire once its runs ended |
| Durable callable removed | The Kernel cancels its runs within minutes, without compensation | Remove once its runs ended |

## Migrate an inline Workflow

Count effects, not Steps or reads:

| The inline Workflow | Becomes |
| --- | --- |
| makes no effect, or one (exclusive branches each making one count as one) | an Action (most cases) |
| makes several writes one Mutation can commit | an Action with that Mutation |
| makes effects that cannot commit together, or waits | a durable Workflow |

Making a read-and-one-write Workflow durable buys a round trip per Step and an Execution to follow,
for no guarantee an Action lacks. An inline Workflow stays only when its effects cannot commit
together and its caller needs the output in the response; then make each effect safe to repeat, so
the caller's retry completes a call that failed halfway.

### To an Action

`defineWorkflow` → `defineAction` (`@astrale-os/sdk/action`), each `step.run` unwrapped; callable,
Schema and callers unchanged.

```ts
const executor = { as: 'executor' } as const

// before: an inline Workflow
export const editComment = defineWorkflow<typeof schema>()(
  'Comment.edit',
  { errors },
  async ({ error, query, mutate, input, self, step }) => {
    const comment = await step.run('read-comment', () => query(commentOf, self, executor))
    const issue = await step.run('read-issue', () => query(issueOf, comment.issue, executor))
    if (issue.archived) throw error('ISSUE_ARCHIVED', {})
    return step.run('edit-comment', () =>
      mutate(editBody, { comment: self, body: input.body }, executor),
    )
  },
)

// after: an Action
export const editComment = defineAction<typeof schema>()(
  'Comment.edit',
  { errors },
  async ({ error, query, mutate, input, self }) => {
    const comment = await query(commentOf, self, executor)
    const issue = await query(issueOf, comment.issue, executor)
    if (issue.archived) throw error('ISSUE_ARCHIVED', {})
    return mutate(editBody, { comment: self, body: input.body }, executor)
  },
)
```

The effect stays last (`actions.md`); a fact that must hold at commit is a `mutation.expect` guard.
Tests invoke the Action's `run` directly (`testing.md`).

### To a durable Workflow

1. Add `execution: { durable: true }` to the callable.
2. Move every Kernel call into a Step: `step.query`, `step.mutate`, else
   `step.run(id, ({ query, mutate, kernel, integrations, dependencies }) => …)`. Drop `caller` and
   `{ as: 'caller' }`.
3. Fix what the typecheck reports: members the durable context lacks; callers reading the output
   (a durable callable answers `ExecutionRef<Output>`).
4. Check what it cannot see: refusals thrown as `error(...)` inside their Step; clock and
   randomness inside a Step; callers that refreshed after the call follow the Execution
   (`useExecution`).
5. `astrale-domain lint`, then the tests above.

```ts
const executor = { as: 'executor' } as const

// before: an inline Workflow
async ({ input, self, query, mutate, integrations, step, error }) => {
  const invoice = await step.run('read-invoice', () => query(invoiceOf, { invoice: self }, executor))
  if (invoice.balance > 0) throw error('OPEN_BALANCE', { invoice: self })
  await step.run('archive', () =>
    mutate(markArchived, { invoice: self, reason: input.reason }, executor),
  )
  await step.run('notify', () => integrations.mailer.send({ invoice: self, template: 'archived' }))
  return null
}

// after: a durable Workflow
async ({ input, self, step, error }) => {
  const invoice = await step.query('read-invoice', invoiceOf, { invoice: self }, executor)
  if (invoice.balance > 0) throw error('OPEN_BALANCE', { invoice: self })
  await step.mutate('archive', markArchived, { invoice: self, reason: input.reason }, executor)
  await step.run('notify', ({ integrations }) =>
    integrations.mailer.send({ invoice: self, template: 'archived' }),
  )
  return null
}
```

## Limits

- A run starts only from a call: no schedule, no graph-event trigger.
- A run waits only on a timer or a signal.
- A Domain cannot list its Executions: record each `execution.id` it needs in the graph.
- No manual pause: `resume` continues only a run the engine paused. A paused Execution's status
  gives no cause; read the Domain's logs.
- The run acts as its Domain, never its caller; the callable's Policy is checked once, at the call.
