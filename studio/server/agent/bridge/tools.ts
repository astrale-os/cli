/**
 * bridge/tools.ts — the Domain Studio write-back tools: what the stdio MCP server
 * advertises, and the bridge route each call is forwarded to.
 */

/** How every tool names a domain of the workspace. */
const DOMAIN_PARAM = {
  type: 'string',
  description:
    'a domain of the workspace, by origin (e.g. "crm.example.dev") or by the path list_domains gave',
} as const

export const BRIDGE_TOOLS = [
  {
    name: 'list_domains',
    description:
      'List every domain in the workspace: origin, path (relative to your working directory), and how many open threads wait in each. Call this to find where to work.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    route: 'domains',
  },
  {
    name: 'list_open_threads',
    description:
      'List every open comment thread (id, domain, path, anchor, file, latest message, and whether it is waiting on agent or user). Pass `domain` to see one domain only.',
    inputSchema: {
      type: 'object',
      properties: { domain: DOMAIN_PARAM },
      additionalProperties: false,
    },
    route: 'threads',
  },
  {
    name: 'get_domain_context',
    description:
      'The context of one domain: the documents the user attached (with their paths) and the saved context notes.',
    inputSchema: {
      type: 'object',
      properties: { domain: DOMAIN_PARAM },
      required: ['domain'],
      additionalProperties: false,
    },
    route: 'context',
  },
  {
    name: 'reply_to_thread',
    description:
      'Append one author reply to a comment thread; the user sees it live in the studio. Existing entries are immutable, so a correction is a new reply. Pass `options` (a short list of concrete choices) to turn the reply into a multiple-choice question the user can pick from or answer freely. Set resolve=true (with a short closeNote) only when the thread is fully handled: a thread you just asked a question in stays open until the user answers.',
    inputSchema: {
      type: 'object',
      properties: {
        commentId: { type: 'string', description: 'the thread id from list_open_threads' },
        text: {
          type: 'string',
          description: 'your reply; a single framing line when offering options',
        },
        options: {
          type: 'array',
          items: { type: 'string' },
          description: '2–5 short choices for the user to pick from; they may also answer freely',
        },
        resolve: { type: 'boolean', description: 'close the thread when done (not when asking)' },
        closeNote: { type: 'string', description: 'one-line summary when resolving' },
      },
      required: ['commentId', 'text'],
      additionalProperties: false,
    },
    route: 'reply',
  },
  {
    name: 'resolve_thread',
    description:
      'Close a comment thread without posting a reply, e.g. after answering it through the conversation or when the user settled it. To answer and close in one step, use reply_to_thread with resolve=true instead. Fails for an unknown commentId.',
    inputSchema: {
      type: 'object',
      properties: {
        commentId: { type: 'string', description: 'the thread id from list_open_threads' },
        closeNote: { type: 'string', description: 'one-line summary shown on the closed thread' },
      },
      required: ['commentId'],
      additionalProperties: false,
    },
    route: 'resolve',
  },
  {
    name: 'post_progress',
    description:
      'Post a short progress note to the studio activity panel, so the user can follow a long turn (a deploy, a multi-step build) while it runs. It is not tied to a thread, is not persisted in any thread, and does not replace the thread replies or the final message.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'one short line; empty text is ignored' },
      },
      required: ['text'],
      additionalProperties: false,
    },
    route: 'progress',
  },
  {
    name: 'raise_question',
    description:
      'Open a NEW question thread in one domain, anchored to a schema element (ref like "class.Monitor.property.url") when you need the user to decide something. Pass `options` for a multiple-choice question — the user picks one or answers freely.',
    inputSchema: {
      type: 'object',
      properties: {
        domain: DOMAIN_PARAM,
        ref: {
          type: 'string',
          description: 'anchor ref, e.g. "class.Order" or "module.inventory/inventory"',
        },
        text: {
          type: 'string',
          description: 'the question (one framing line when offering options)',
        },
        file: {
          type: 'string',
          description:
            'optional source file the anchored element lives in, to pin the thread to it',
        },
        options: {
          type: 'array',
          items: { type: 'string' },
          description: '2–5 short choices the user can pick from',
        },
      },
      required: ['domain', 'ref', 'text'],
      additionalProperties: false,
    },
    route: 'raise_question',
  },
] as const
