/**
 * Item Endpoints
 */

import { moduleId } from '@astrale/react'
import { z } from 'zod'

import { App } from '../schema'
import type { Item } from '../types'

export const createItem = App.workerEndpoint({
  name: 'items.create',
  inputSchema: z.object({
    title: z.string().min(1),
    content: z.string(),
  }),
  handler: async ({ title, content }, ctx) => {
    const now = new Date().toISOString()

    const { moduleId: id } = await ctx.appdata.avatar.root.createModule('ITEM', {
      name: title,
      metadata: { title, createdAt: now },
      data: { content },
    })

    return { id, title, createdAt: now }
  },
})

export const listItems = App.workerEndpoint({
  name: 'items.list',
  inputSchema: z.object({
    limit: z.number().min(1).max(100).default(20),
  }),
  handler: async ({ limit }, ctx) => {
    const result = await ctx.appdata.avatar.root.findByType('ITEM', { limit })
    const opened = await ctx.appdata.avatar.root.openModules(result.items, 'ITEM')

    const items: Item[] = opened.map((i) => ({
      id: i.moduleId,
      title: i.metadata?.title ?? 'Untitled',
      createdAt: i.metadata?.createdAt ?? '',
      data: { content: (i.data as { content: string })?.content ?? '' },
    }))

    return { items }
  },
})

export const deleteItem = App.workerEndpoint({
  name: 'items.delete',
  inputSchema: z.object({
    itemId: moduleId(),
  }),
  handler: async ({ itemId }, ctx) => {
    await ctx.appdata.avatar.root.child(itemId).delete()
    return { success: true }
  },
})
