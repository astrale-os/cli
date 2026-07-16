import type { LoadoutSkill } from '@shared/types'

import { Check, ChevronRight, Copy } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { useSkillContent } from '@/lib/hooks'
import { cn } from '@/lib/utils'

const FEATURED = ['astrale-cli', 'astrale-domain', 'agent-browser']

const SKILL_INSTALL: Record<string, string[]> = {
  'astrale-cli': ['npx skills add astrale-os/cli -g'],
  'astrale-domain': ['npx skills add astrale-os/cli -g'],
  'agent-browser': [
    'npm install -g agent-browser && agent-browser install',
    'npx skills add vercel-labs/agent-browser -g',
  ],
}

function SkillRow({
  skill,
  domainId,
  expanded,
  onToggle,
}: {
  skill: LoadoutSkill
  domainId?: string
  expanded: boolean
  onToggle: () => void
}) {
  const { data: content, isLoading } = useSkillContent(
    expanded ? domainId : undefined,
    expanded ? skill.command : undefined,
  )
  const tag = skill.source === 'plugin' ? (skill.plugin ?? 'plugin') : skill.source
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-muted/40"
        title={skill.description ?? skill.command}
      >
        <span
          className={cn(
            'h-1.5 w-1.5 shrink-0 rounded-full',
            skill.loaded ? 'bg-emerald-500' : 'bg-amber-500',
          )}
          title={
            skill.loaded ? 'available to the selected harness here' : 'installed but disabled here'
          }
        />
        <span className="truncate font-mono text-[12px]">{skill.command}</span>
        <span className="ml-auto shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground/80">
          {tag}
        </span>
        <ChevronRight
          className={cn(
            'h-3 w-3 shrink-0 text-muted-foreground/50 transition-transform',
            expanded && 'rotate-90',
          )}
        />
      </button>
      {expanded && (
        <div className="border-t bg-background/60 px-2.5 py-2">
          {isLoading ? (
            <p className="text-[11px] text-muted-foreground/60">Loading…</p>
          ) : content ? (
            <>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/40 p-2 text-[11px] leading-relaxed">
                {content.content}
              </pre>
              <p
                className="mt-1 truncate font-mono text-[10px] text-muted-foreground/50"
                title={content.path}
              >
                {content.path}
              </p>
            </>
          ) : (
            <p className="text-[11px] text-muted-foreground/60">
              Couldn't read this skill's SKILL.md.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(command)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch {
          toast.error('Copy failed — select the command and copy it manually.')
        }
      }}
      className="group flex w-full items-center gap-2 rounded bg-muted/40 px-2 py-1 text-left font-mono text-[11px] transition-colors hover:bg-muted"
      title="Copy to clipboard"
    >
      <span className="truncate">{command}</span>
      {copied ? (
        <Check className="ml-auto h-3 w-3 shrink-0 text-emerald-500" />
      ) : (
        <Copy className="ml-auto h-3 w-3 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-foreground" />
      )}
    </button>
  )
}

function MissingSkillRow({ command }: { command: string }) {
  const [open, setOpen] = useState(false)
  const commands = SKILL_INSTALL[command]
  return (
    <div>
      <button
        type="button"
        onClick={() => commands && setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-muted/40"
        title="not installed on disk in this workspace — click to see how"
      >
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-destructive" title="not installed" />
        <span className="truncate font-mono text-[12px] text-muted-foreground/60 line-through">
          {command}
        </span>
        <span className="ml-auto shrink-0 rounded bg-destructive/15 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
          not installed
        </span>
        {commands && (
          <ChevronRight
            className={cn(
              'h-3 w-3 shrink-0 text-muted-foreground/50 transition-transform',
              open && 'rotate-90',
            )}
          />
        )}
      </button>
      {open && commands && (
        <div className="space-y-1.5 border-t bg-background/60 px-2.5 py-2">
          <p className="text-[11px] text-muted-foreground/70">Run, then hit re-probe above:</p>
          {commands.map((command) => (
            <CopyCommand key={command} command={command} />
          ))}
          <p className="text-[10px] text-muted-foreground/50">
            Or run <span className="font-mono">astrale setup</span> to equip everything at once.
          </p>
        </div>
      )}
    </div>
  )
}

/** Expandable skill inventory for the selected harness. */
export function SkillList({ skills, domainId }: { skills: LoadoutSkill[]; domainId?: string }) {
  const [showAll, setShowAll] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const byCommand = new Map(skills.map((skill) => [skill.command, skill]))
  const featured = new Set(FEATURED)
  const rest = skills
    .filter((skill) => !featured.has(skill.command))
    .sort(
      (left, right) =>
        Number(left.loaded) - Number(right.loaded) || left.command.localeCompare(right.command),
    )

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <span>Skills</span>
        <span className="ml-auto font-mono text-[11px] text-muted-foreground/80">
          {skills.filter((skill) => skill.loaded).length} loaded / {skills.length}
        </span>
      </div>
      <div
        className={cn(
          'divide-y divide-border/50 overflow-hidden rounded-md border bg-background/40',
          showAll && 'max-h-64 overflow-y-auto',
        )}
      >
        {FEATURED.map((command) => {
          const skill = byCommand.get(command)
          return skill ? (
            <SkillRow
              key={command}
              skill={skill}
              domainId={domainId}
              expanded={expanded === command}
              onToggle={() => setExpanded((current) => (current === command ? null : command))}
            />
          ) : (
            <MissingSkillRow key={command} command={command} />
          )
        })}
        {showAll &&
          rest.map((skill) => (
            <SkillRow
              key={skill.command}
              skill={skill}
              domainId={domainId}
              expanded={expanded === skill.command}
              onToggle={() =>
                setExpanded((current) => (current === skill.command ? null : skill.command))
              }
            />
          ))}
      </div>
      {rest.length > 0 && (
        <button
          type="button"
          onClick={() => setShowAll((value) => !value)}
          className="px-1 text-[11px] text-muted-foreground/60 transition-colors hover:text-foreground"
        >
          {showAll ? 'Hide others' : `Show all (${rest.length} more)`}
        </button>
      )}
    </div>
  )
}
