/**
 * The Inspector's page for a View, the same under every lens: what it is, where the Schema
 * declares it, what its code reaches as read from source, and the one thing to do with it —
 * open it on the active instance, chosen beside Open — or, under a disabled Open, the one reason
 * it cannot open.
 */
import type {
  StudioSchemaBundle,
  ViewClassRead,
  ViewReach,
  ViewReachRead,
} from '@shared/contracts/schema'

import { publicationOf } from '@shared/contracts/versions'
import { useMemo, useState } from 'react'

import { activeInstanceWarning, InstanceSwitcher } from '@/components/instance-switcher'
import { Button } from '@/components/ui/button'
import { ViewModal } from '@/components/view-modal'
import { useAnatomy, useInstances } from '@/lib/hooks'
import { viewAnchor } from '@/lib/views'

import { definitionTarget } from '../../schema-studio/definitions'
import { moduleLabel } from '../../schema-studio/modules'
import { GLYPHS } from '../canvas/glyphs'
import { TONE_COLOR } from '../canvas/tones'
import {
  classOfRead,
  openBlocker,
  type Reachable,
  VIEW_KIND,
  type ViewFacts,
  viewPlace,
  viewsOf,
  viewsReaching,
} from '../lenses/views'
import { Untold } from './behavior-view'
import {
  CallableName,
  ClassName,
  Empty,
  Fact,
  Fold,
  Link,
  Meta,
  Page,
  Section,
  Title,
} from './parts'
import { classLink } from './structure'
import { callableTargetOf, type InspectorTarget } from './target'

const SCHEMA_DIR = 'schema'

const where = (file: string, line?: number) => `${file}${line === undefined ? '' : `:${line}`}`

export function ViewPage({ bundle, slug }: { bundle: StudioSchemaBundle; slug: string }) {
  const published = publicationOf(bundle.domainId) !== undefined
  const { data: anatomy } = useAnatomy(bundle.domainId)
  const view = useMemo(
    () => viewsOf(bundle, anatomy).find((each) => each.slug === slug),
    [anatomy, bundle, slug],
  )
  const anchor = viewAnchor(slug)
  const kicker = [
    'View',
    view && view.module !== 'root' ? moduleLabel(view.module, SCHEMA_DIR) : undefined,
  ]
    .filter((each) => each !== undefined)
    .join(' · ')
  return (
    <Page
      domainId={bundle.domainId}
      data-comment-outline-inset=""
      data-inspector-view={slug}
      data-anchor-ref={anchor}
      data-anchor-excerpt={slug}
      data-commentable=""
    >
      <Title
        kicker={kicker}
        name={slug}
        icon={<GLYPHS.view style={{ color: TONE_COLOR.view }} />}
        {...(view?.description === undefined ? {} : { description: view.description })}
        domainId={bundle.domainId}
        anchor={anchor}
        {...(view?.declared === undefined ? {} : { file: view.declared.file })}
      />
      {view === undefined ? (
        <Empty>
          {anatomy === undefined && !published
            ? 'Reading the Domain’s sources…'
            : `The Schema declares no View ${slug}.`}
        </Empty>
      ) : (
        <>
          <ViewFactsBlock view={view} />
          <OpenView domainId={bundle.domainId} view={view} />
          <Reaches bundle={bundle} view={view} />
        </>
      )}
    </Page>
  )
}

/**
 * What the View is, under its title: how it is built, where it opens, where the Schema declares
 * it, and where its frontend is declared when that is another file.
 */
function ViewFactsBlock({ view }: { view: ViewFacts }) {
  const kind = VIEW_KIND[view.kind]
  const place = viewPlace(view)
  return (
    <div className="-mt-3 space-y-1.5" data-inspector-view-facts="">
      <Fact label="Built as">
        {kind !== undefined ? (
          kind
        ) : (
          <span className="text-muted-foreground">
            {view.published
              ? 'Not known: a published bundle holds no View code.'
              : 'Not known: no code serving it was found in the Domain’s sources.'}
          </span>
        )}
      </Fact>
      {place !== undefined && (
        <Fact label={view.mount !== undefined ? 'Mounts at' : 'Served at'}>
          <span className="break-all font-mono text-[12.5px]">{view.mount ?? view.url}</span>
        </Fact>
      )}
      {view.entrypoint && <Fact label="Entrypoint">The Domain opens it first.</Fact>}
      {view.drift === 'missing-impl' && (
        <Fact label="Route">
          <span className="text-warning">
            It mounts at {view.mount}, which no route of the client serves.
          </span>
        </Fact>
      )}
      {view.declared !== undefined && (
        <Fact label="Declared">
          <span className="break-all font-mono text-[11.5px] text-muted-foreground">
            {where(view.declared.file, view.declared.line)}
          </span>
        </Fact>
      )}
      {view.file !== undefined && view.file !== view.declared?.file && (
        <Fact label="Frontend">
          <span className="break-all font-mono text-[11.5px] text-muted-foreground">
            {view.file}
          </span>
        </Fact>
      )}
    </div>
  )
}

/**
 * The page's one action: open the View on the active instance, chosen beside it, or the reason it
 * cannot. A published bundle holds no View code: no instance is chosen for it.
 */
function OpenView({ domainId, view }: { domainId: string; view: ViewFacts }) {
  const [open, setOpen] = useState(false)
  const instances = useInstances()
  const list = instances.data?.instances
  const blocker = instances.isError
    ? 'The instances could not be read, so no View can open.'
    : openBlocker(view, list, list === undefined ? null : activeInstanceWarning(list))
  return (
    <div className="space-y-1.5" data-inspector-open="">
      <div className="flex min-w-0 items-center gap-2">
        <Button
          size="sm"
          disabled={blocker !== undefined}
          onClick={() => setOpen(true)}
          data-action="open-view"
          aria-describedby={blocker === undefined ? undefined : `open-view-${view.slug}`}
        >
          <GLYPHS.view />
          Open
        </Button>
        {!view.published && (
          <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-muted-foreground">
            on
            <InstanceSwitcher />
          </span>
        )}
      </div>
      {blocker !== undefined && (
        <p
          id={`open-view-${view.slug}`}
          data-open-blocker=""
          className="text-[12px] leading-relaxed text-muted-foreground"
        >
          {blocker}
        </p>
      )}
      {open && <ViewModal domainId={domainId} view={view} open={open} onOpenChange={setOpen} />}
    </div>
  )
}

/** What the View's code reaches, read from its sources; what the reading cannot tell, said. */
function Reaches({ bundle, view }: { bundle: StudioSchemaBundle; view: ViewFacts }) {
  const reach: ViewReach | undefined = view.reach
  if (view.published)
    return (
      <Section label="Reaches" kind="calls" data-inspector-reach="published">
        <Empty>
          A published bundle holds no View code: what it calls and reads cannot be read.
        </Empty>
      </Section>
    )
  if (reach === undefined)
    return (
      <Section label="Reaches" kind="calls" data-inspector-reach="unread">
        <Empty>The Studio does not read what this View’s code calls and reads.</Empty>
      </Section>
    )
  if (reach.status === 'none')
    return (
      <Section label="Reaches" kind="calls" data-inspector-reach="none">
        <Empty>{reach.reason}</Empty>
      </Section>
    )
  if (reach.status === 'unread')
    return (
      <Section label="Reaches" kind="calls" data-inspector-reach="unread">
        <Empty>{reach.reason}</Empty>
        {reach.file !== undefined && (
          <span className="block break-all font-mono text-[11.5px] text-muted-foreground">
            {where(reach.file, reach.line)}
          </span>
        )}
      </Section>
    )
  return <ReachRead bundle={bundle} reach={reach} />
}

function ReachRead({ bundle, reach }: { bundle: StudioSchemaBundle; reach: ViewReachRead }) {
  const domainId = bundle.domainId
  const nothing =
    reach.calls.length === 0 &&
    reach.definitions.length === 0 &&
    reach.reads.length === 0 &&
    reach.ownDefinitions.length === 0
  return (
    <>
      <div className="-mt-3 space-y-1.5" data-inspector-reach="read">
        <Fact label="Read from">
          <span className="break-all font-mono text-[11.5px] text-muted-foreground">
            {reach.entries.join(' · ')}
          </span>
          <span className="block text-[12px] text-muted-foreground">
            {reach.files} {reach.files === 1 ? 'module' : 'modules'} followed, never run
          </span>
        </Fact>
        {reach.scope === 'frontend' && (
          <Fact label="Shared">
            <span className="text-muted-foreground">
              {reach.sharedWith.join(', ')} {reach.sharedWith.length === 1 ? 'starts' : 'start'}{' '}
              from the same code: what follows is their frontend’s, and which of it this View
              reaches cannot be told from source.
            </span>
          </Fact>
        )}
        {reach.inferred !== undefined && (
          <Fact label="Tied by">
            <span className="text-muted-foreground">{reach.inferred}</span>
          </Fact>
        )}
      </div>
      {nothing && reach.gaps.length === 0 && (
        <Section label="Reaches" kind="calls">
          <Empty>Its code calls and reads nothing of the Domain.</Empty>
        </Section>
      )}
      {reach.calls.length > 0 && (
        <Section label="Calls" kind="calls" count={reach.calls.length} data-inspector-view-calls="">
          <Fold
            items={reach.calls}
            render={(call) => (
              <div key={call.key} className="space-y-0.5">
                <p className="text-[13px] leading-relaxed">
                  <CallableName
                    target={
                      callableExists(bundle, call.key) ? callableTargetOf(call.key) : undefined
                    }
                    name={call.key}
                    glyph="function"
                    domainId={domainId}
                  />
                </p>
                <Sites sites={call.sites} />
              </div>
            )}
          />
        </Section>
      )}
      {reach.reads.length > 0 && (
        <Section label="Reads" kind="reads" count={reach.reads.length} data-inspector-view-reads="">
          <Fold
            items={reach.reads}
            render={(read) => (
              <div key={read.class} className="space-y-0.5">
                <p className="text-[13px] leading-relaxed">
                  <ClassName
                    link={classLink(bundle, classRefOf(bundle, read))}
                    domainId={domainId}
                  />
                </p>
                {read.definitions.length > 0 && <Meta>through {read.definitions.join(', ')}</Meta>}
                <Sites sites={read.sites} />
              </div>
            )}
          />
        </Section>
      )}
      {reach.definitions.length > 0 && (
        <Section label="Uses" count={reach.definitions.length} data-inspector-view-uses="">
          <Fold
            items={reach.definitions}
            render={(use) => (
              <div key={`${use.kind}.${use.id}`} className="space-y-0.5">
                <p className="text-[13px] leading-relaxed">
                  <CallableName
                    target={
                      bundle.overlay.definitions.some(
                        (definition) => definition.kind === use.kind && definition.id === use.id,
                      )
                        ? definitionTarget(use)
                        : undefined
                    }
                    name={use.id}
                    glyph={use.kind === 'query' ? 'query' : 'mutation'}
                    domainId={domainId}
                  />
                </p>
                <Sites sites={use.sites} />
              </div>
            )}
          />
        </Section>
      )}
      {reach.ownDefinitions.length > 0 && (
        <Section label="Its own definitions" count={reach.ownDefinitions.length}>
          <Empty>
            Declared in the View’s code, so the Studio does not read their effects:{' '}
            {reach.ownDefinitions.map((definition) => definition.id).join(', ')}.
          </Empty>
        </Section>
      )}
      {reach.gaps.length > 0 && <Untold gaps={reach.gaps} />}
    </>
  )
}

/** Where the code names it: the first place, and how many more. */
function Sites({ sites }: { sites: readonly { file: string; line: number }[] }) {
  const [first] = sites
  if (first === undefined) return null
  return (
    <span className="block break-all font-mono text-[11.5px] text-muted-foreground">
      {where(first.file, first.line)}
      {sites.length > 1 && <span className="font-sans"> and {sites.length - 1} more</span>}
    </span>
  )
}

const callableExists = (bundle: StudioSchemaBundle, key: string) => {
  const dot = key.indexOf('.')
  const ir = bundle.ir
  if (ir === null) return false
  return dot < 0
    ? ir.functions[key] !== undefined
    : ir.classes[key.slice(0, dot)]?.methods[key.slice(dot + 1)] !== undefined
}

/** The Class a View reads, as a reference the Structure lens opens. */
const classRefOf = (bundle: StudioSchemaBundle, read: ViewClassRead) =>
  classOfRead(read.class, bundle.ir?.domain ?? bundle.domainId)

/**
 * The Views lens's answer about a Class, a function or a definition: the Views whose code reaches
 * it, as read from source, and the Views whose code could not be read in full, so a View left
 * out of the list is said not to reach it only when every View's code was read.
 */
export function ViewsBody({
  bundle,
  target,
}: {
  bundle: StudioSchemaBundle
  target: Exclude<InspectorTarget, { kind: 'missing' | 'view' }>
}) {
  const published = publicationOf(bundle.domainId) !== undefined
  const { data: anatomy } = useAnatomy(bundle.domainId)
  const views = useMemo(() => viewsOf(bundle, anatomy), [anatomy, bundle])
  const domain = bundle.ir?.domain ?? bundle.domainId
  const what = reachableOf(target)
  const name = target.kind === 'class' ? target.ref.name : nameOf(target)
  if (views.length === 0)
    return (
      <Section label="Views" kind="views">
        <Empty>
          {published
            ? 'The published Schema declares no View.'
            : 'This Domain declares no View: nothing here is shown to people.'}
        </Empty>
      </Section>
    )
  if (published)
    return (
      <Section label="Views" kind="views">
        <Empty>
          A published bundle holds no View code: which of its Views reach {name} cannot be read.
        </Empty>
      </Section>
    )
  if (what === undefined)
    return (
      <Section label="Views" kind="views">
        <Empty>
          A View reaches the Domain through its functions and definitions, never an Integration
          directly.
        </Empty>
      </Section>
    )
  const { reaching, untold } = viewsReaching(views, what, domain)
  return (
    <Section label="Views" kind="views" count={reaching.length} data-inspector-views-reaching="">
      {reaching.length > 0 ? (
        <div className="space-y-1.5">
          {reaching.map(({ view, how, shared }) => (
            <p key={view.slug} className="text-[13px] leading-relaxed">
              <GLYPHS.view
                aria-hidden
                className="mr-[0.3em] inline-block h-[1em] w-[1em] align-[-0.15em]"
                style={{ color: TONE_COLOR.view }}
              />
              <Link target={view.id} domainId={bundle.domainId}>
                {view.slug}
              </Link>
              <span className="text-muted-foreground">
                {' '}
                {how === 'calls' ? 'calls it' : how === 'reads' ? 'reads it' : 'uses it'}
                {shared && ', through the frontend it shares'}
              </span>
            </p>
          ))}
        </div>
      ) : untold.length === 0 ? (
        <Empty>No View’s code reaches {name}.</Empty>
      ) : null}
      {untold.length > 0 && (
        <Meta>
          {untold.length === views.length
            ? `What each View’s code reaches is not read, so which of them reach ${name} is not known.`
            : `The code of ${untold.map((view) => view.slug).join(', ')} could not be read in full: ${untold.length === 1 ? 'it' : 'they'} may reach ${name} too.`}
        </Meta>
      )}
    </Section>
  )
}

function reachableOf(
  target: Exclude<InspectorTarget, { kind: 'missing' | 'view' }>,
): Reachable | undefined {
  switch (target.kind) {
    case 'class':
      return { kind: 'class', origin: target.ref.origin, name: target.ref.name }
    case 'function':
      return { kind: 'function', key: target.key }
    case 'definition':
      return { kind: 'definition', definition: target.definition.kind, id: target.definition.id }
    case 'integration':
      return undefined
  }
}

function nameOf(target: Exclude<InspectorTarget, { kind: 'missing' | 'view' | 'class' }>) {
  return target.kind === 'function'
    ? target.key
    : target.kind === 'definition'
      ? target.definition.id
      : target.integration.key
}
