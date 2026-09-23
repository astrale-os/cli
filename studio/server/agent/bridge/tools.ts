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
      'Post a concise reply to one comment thread so the user sees it live; only make it longer when the comment genuinely needs the detail. Say what you changed, answer a question, or ask one back. Pass `options` (a short list of concrete choices) to turn the reply into a multiple-choice question the user can pick from (or answer freely). Set resolve=true with a short closeNote ONLY when fully handled — never resolve a question you just asked.',
    inputSchema: {
      type: 'object',
      properties: {
        commentId: { type: 'string', description: 'the thread id from list_open_threads' },
        text: {
          type: 'string',
          description: 'your reply (concise — a framing line when offering options)',
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
    description: 'Mark a comment thread resolved (closed) with an optional closeNote.',
    inputSchema: {
      type: 'object',
      properties: { commentId: { type: 'string' }, closeNote: { type: 'string' } },
      required: ['commentId'],
      additionalProperties: false,
    },
    route: 'resolve',
  },
  {
    name: 'post_progress',
    description:
      'Post a short progress note shown in the studio activity panel (not tied to a thread).',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
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
        file: { type: 'string' },
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
