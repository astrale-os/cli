---
name: astrale-frontend-design
description: "Design, implement, review, and refine focused product interfaces for Astrale Domain Views embedded in the Astrale GUI. Use when working on information architecture, layout, React or UI components, forms, lists, menus, dialogs, loading/empty/error/mutation states, perceived latency, prefetching, navigation, interaction polish, responsive behavior, accessibility, or interface copy in a Domain frontend."
---

# Astrale Frontend Design

A Domain View renders inside the Astrale GUI shell: a focused product interface, never a landing
page. Apply with the `astrale-domain` View guidance; reuse the host's visual language and the
project's primitives unless the task sets another direction.

## Information architecture

Before writing UI code, sketch a high-level wireframe, mentally or in a temporary note: the primary
task, the sections and subsections, the links between them, their relative importance, what belongs
together, and the parent of every subsection.

## Layout and aesthetics

- No hero, presentation area, redundant page header or empty space before useful content.
- Task priority sets order, space and weight; each section is one logical unit; state and controls
  sit next to the content they affect.
- Few strong regions, clear hierarchy, compact spacing, consistent controls.
- Refused by default: a card per element, containers nested without a grouping need, cards lifting
  on hover, decorative gradients, pills, oversized metrics, ornamental animation or copy, cream or
  off-white backgrounds, italic accent words in headlines, numbered "01/02/03" section labels,
  monospace labels, pill-shaped buttons. Each visual device must encode structure, state, priority
  or affordance; hover only clarifies interaction and has a keyboard and touch equivalent.

## Interaction states

A flow is complete only when initial, loading, empty, ready, submitting, success, failure,
unauthorized and disabled states are modeled.

- Loading at the waiting scope only: inside the submitted button, or a layout-matching skeleton per
  section on first load. One indicator per action.
- No duplicate submission; input kept on failure; feedback next to the affected control.
- Creation shows its success and inserts the result where expected; focus moves only when it serves
  the next task. Deletion distinguishes reversible removal from destruction; confirm only when the
  consequence warrants it.
- Optimistic updates only when the result is predictable. On failure: roll back, show the failure,
  reconcile with the committed Kernel state.
- Dropdowns close on outside click and Escape, support keyboard navigation, expose the selected
  item and return focus to the trigger.
- Dialogs, menus, forms and inline actions work by keyboard: visible focus, semantic controls,
  associated labels, announced status and errors.
- Long labels and values are layout cases: wrap when read, truncate only in fixed space with access
  to the full value, never over adjacent actions.
- Hover, disabled, pending, success and error states are distinct, never by color alone.

## Latency (`@astrale-os/shell-react`)

Kernel calls can take seconds. Use the Store before writing any cache or loader.

| Rule | Mechanism |
| --- | --- |
| Skeleton only while `data === undefined` | Keep content while `state` is `stale` or `refreshing` |
| Changing input keeps the old result | `useQuery(definition, input, { keepPrevious: true })`; render `previous?.data` dimmed; defer typed input |
| Independent sections load in parallel | One named Query per section |
| Dependent reads in one round trip | `defineCompositeQuery`, never a parent-then-child waterfall |
| Identical reads are shared | Never cache by hand |
| Inactive tabs | Unmount: the Store keeps the result and refreshes it in the background on return |
| Prefetch the likely next step only | `Link` warms its target (`prefetch: 'intent'` by default); otherwise one `useQuery(next ? definition : null, input)` slot, never every row or tab |
| Reuse window | A read is reused for 30 s and never refreshes by itself: `refreshInterval` or `refresh()` for changes made elsewhere |

- `useMutation` is optimistic by default, only for `node.update` / `node.delete` of loaded nodes;
  `useAction` is not. For a predictable action: `useOptimistic` in `startTransition`,
  `await run()`, then `await query.refresh()`, and catch the error. Never optimistic for payments
  or access.
- `useAction` refreshes every Query (`refresh: 'all'`) by default; narrow it only when every
  affected Query is listed.
- A durable callable answers with its Execution at once: release the form and show progress in
  place.

## Navigation

- `defineNavigation`, `NavigationScope`, `urlAdapter()` (or an existing History API router); never a
  hand-written `popstate` store. Browser Back, Forward and deep links reach the View only with the
  host's `navigation.history` grant; without it, `memoryAdapter()`.
- Shareable state (record, tab, filters) lives in the URL; filter changes use `replace`.

## Copy

Keep only text that explains state or enables a decision or action, plus labels and accessibility
text; no introductions, repetition, obvious help, decorative copy, or descriptions restating a
heading or control. After implementation, a dedicated pass reads every visible string in context
and removes each one whose absence does not hurt understanding or action.

## Verification

Run the real flows with representative, empty, long, loading and failing data: creation, deletion,
rollback, outside click and Escape, keyboard order, narrow layouts, visible feedback. On a
throttled network: tab returns, optimistic writes, waterfalls, Back. Then remove redundant cards,
effects, copy and space before useful content.
