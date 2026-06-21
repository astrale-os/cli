import type { Components } from 'react-markdown'

/**
 * markdown.tsx — one compact, safe markdown renderer shared by every surface that
 * shows agent prose (the live activity drawer + the comment threads). HTML in the
 * source is NOT rendered (react-markdown's safe default), so this is XSS-safe, and
 * no `node` prop ever reaches the DOM.
 */
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { cn } from '@/lib/utils'

const MD: Components = {
  p: ({ node, ...p }) => <p className="mb-2 leading-relaxed last:mb-0" {...p} />,
  h1: ({ node, ...p }) => (
    <h3 className="mb-1 mt-1.5 text-[13px] font-semibold first:mt-0" {...p} />
  ),
  h2: ({ node, ...p }) => (
    <h3 className="mb-1 mt-1.5 text-[13px] font-semibold first:mt-0" {...p} />
  ),
  h3: ({ node, ...p }) => (
    <h4 className="mb-1 mt-1.5 text-[13px] font-semibold first:mt-0" {...p} />
  ),
  ul: ({ node, ...p }) => <ul className="mb-2 list-disc space-y-0.5 pl-4 last:mb-0" {...p} />,
  ol: ({ node, ...p }) => <ol className="mb-2 list-decimal space-y-0.5 pl-4 last:mb-0" {...p} />,
  li: ({ node, ...p }) => <li className="leading-relaxed" {...p} />,
  a: ({ node, ...p }) => (
    <a
      className="text-primary underline underline-offset-2"
      target="_blank"
      rel="noreferrer"
      {...p}
    />
  ),
  strong: ({ node, ...p }) => <strong className="font-semibold text-foreground" {...p} />,
  em: ({ node, ...p }) => <em className="italic" {...p} />,
  code: ({ node, ...p }) => (
    <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11.5px]" {...p} />
  ),
  pre: ({ node, ...p }) => (
    <pre
      className="mb-2 max-w-full overflow-x-auto rounded-md bg-muted/70 p-2.5 text-[11.5px] leading-relaxed last:mb-0 [&>code]:bg-transparent [&>code]:p-0"
      {...p}
    />
  ),
  blockquote: ({ node, ...p }) => (
    <blockquote
      className="mb-2 border-l-2 border-border pl-3 text-muted-foreground last:mb-0"
      {...p}
    />
  ),
  hr: ({ node, ...p }) => <hr className="my-2 border-border" {...p} />,
  table: ({ node, ...p }) => (
    <table className="mb-2 w-full table-fixed border-collapse text-[12px] last:mb-0" {...p} />
  ),
  th: ({ node, ...p }) => (
    <th
      className="border border-border px-2 py-1 text-left font-semibold [overflow-wrap:anywhere]"
      {...p}
    />
  ),
  td: ({ node, ...p }) => (
    <td className="border border-border px-2 py-1 align-top [overflow-wrap:anywhere]" {...p} />
  ),
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div
      className={cn('min-w-0 text-[13px] text-foreground/90 [overflow-wrap:anywhere]', className)}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD}>
        {text}
      </ReactMarkdown>
    </div>
  )
}
