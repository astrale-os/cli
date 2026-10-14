---
name: astrale-frontend-design
description: "Design, implement, review, and refine focused product interfaces for Astrale Domain Views embedded in the Astrale GUI. Use when working on information architecture, layout, React or UI components, forms, lists, menus, dialogs, loading/empty/error/mutation states, perceived latency, prefetching, navigation, interaction polish, responsive behavior, accessibility, or interface copy in a Domain frontend."
---

# Astrale Frontend Design

Build the Domain as a focused product interface, not a landing page. Domains live inside the
Astrale GUI and inherit its surrounding shell. Do not add a hero, large presentation area,
redundant page header, or empty space before useful content.

Apply this skill together with `astrale-domain` View guidance. Reuse the host application's visual
language and the project's existing primitives unless the task establishes a different direction.

## Plan The Information Architecture

Before writing UI code, sketch a high-level wireframe mentally or in a temporary note. Identify:

- the user's primary task;
- the main sections and subsections;
- the logical links between them;
- their relative importance;
- which information belongs together;
- the correct parent for every subsection.

Make every section one coherent logical unit. Let information architecture and task priority drive
the layout, order, space, and visual weight. Put state and controls close to the content they affect.

## Keep The Interface Restrained

Avoid AI-slop aesthetics. Do not turn every element into a card, nest containers without a real
grouping need, or make cards lift on hover. Use hover only to clarify interaction, and provide the
same clarity for keyboard and touch users.

Prefer a small number of strong regions, clear hierarchy, compact spacing, and consistent controls.
Do not add decorative gradients, pills, oversized metrics, animation, or ornamental copy by default.
Each visual device must communicate structure, state, priority, or affordance.

Do not use a cream or off-white background, italic accent words in headlines, numbered
"01/02/03" section labels, monospace labels, or pill-shaped buttons.

## Make Interaction States Precise

Model the relevant initial, loading, empty, ready, submitting, success, failure, unauthorized, and
disabled states before considering a flow complete.

- Show loading at the scope that is actually waiting: inside a submitted button for a local action,
  or with a layout-matching skeleton per section on first load. Never show multiple spinners or
  progress bars for one action.
- Prevent duplicate submissions. Preserve user input on failure and place actionable feedback next
  to the affected control or content.
- Handle creation clearly: show that the action succeeded, insert the result where the user expects
  it, and move focus only when doing so helps the next task.
- Handle deletion clearly: distinguish reversible removal from destructive deletion and confirm only
  when the consequence warrants interruption.
- Use optimistic list updates when the result is predictable. Roll back on failure, show the failure,
  and reconcile the interface with committed Kernel state.
- Close an open dropdown when the user clicks outside it or presses Escape. Support keyboard
  navigation, expose the selected item, and return focus to the trigger when appropriate.
- Make long labels and values part of layout testing. Wrap when reading matters; truncate only in
  genuinely fixed space and provide access to the full value. Never let text cover adjacent actions.
- Keep dialogs, menus, forms, and inline actions usable by keyboard. Use visible focus, semantic
  controls, correctly associated labels, and accessible status or error announcements.
- Make hover, disabled, pending, success, and error states visually distinct without relying on color
  alone.

## Hide Latency

Kernel calls can take seconds. Rely on `@astrale-os/shell-react` before writing any cache or loader.

- Show a skeleton only while `data === undefined`; keep content while `stale` or `refreshing`. When
  input changes, pass `keepPrevious` and render `previous?.data` dimmed; defer typed input.
- Give each independent section its own named Query so sections load in parallel and paint when
  ready. Put dependent reads in one `defineCompositeQuery`, not a parent-then-child waterfall.
  Identical reads are already shared: never cache by hand.
- Unmount inactive tabs: the Store keeps their result and refreshes it in the background on return.
- Prefetch only the likely next step (`Link` already warms its node) with one
  `useQuery(next ? definition : null, input)` slot, never every row or tab.
- `useMutation` is optimistic for updates and deletes of loaded nodes; `useAction` is not. For a
  predictable action, use `useOptimistic` in `startTransition`, `await run()` then
  `await query.refresh()` so nothing flickers, and catch the error. Never for payments or access.
- A read is reused for 30 s and never refreshes by itself: poll (`refreshInterval`) or call
  `refresh()` for changes made elsewhere. Keep `refresh: 'all'` on actions unless every affected
  Query is listed.
- A durable callable returns its Execution at once: release the form and show progress in place.

## Navigate Through The Shell

- Use `defineNavigation`, `NavigationScope`, and `urlAdapter()` (or an existing History API router),
  never a hand-written `popstate` store. With the host's `navigation.history` grant, browser Back,
  Forward, and deep links reach the app; without it, use `memoryAdapter()`.
- Put shareable state (record, tab, filters) in the URL, with `replace` for filter changes.

## Reduce Text Deliberately

Keep only text that helps the user understand the state, decide, or act. Preserve necessary labels,
feedback, and accessibility text. Remove introductions, repetition, obvious help, decorative copy,
and descriptions that merely restate a heading or control.

After implementation, perform a dedicated text-reduction pass. Read every visible string in context
and remove it unless the interface becomes harder to understand, decide from, or act on.

## Verify The Result

Exercise the real task flows with representative, empty, long, loading, and failing data. Check
creation, deletion, rollback, outside-click and Escape behavior, keyboard order, narrow layouts, and
visible feedback. On a throttled network, check tab returns, optimistic writes, waterfalls, and
Back. Then review the whole screen once more and remove redundant cards, effects, copy,
and space before useful content.
