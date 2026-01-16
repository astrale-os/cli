/**
 * App Definition
 *
 * Defines modules, links, and appdata structure.
 */

import { container, defineApp, item, module, v } from '@astrale/react'

import { ItemData, ItemMeta } from './schemas'
import { initialWindowState, WindowState } from './state'

export const App = defineApp({
  app: {
    name: '{{APP_NAME}}',
    slug: '{{APP_SLUG}}',
    version: v.semver(1, 0),
    description: '{{APP_NAME}} - Astrale app',
  },

  modules: {
    ROOT: container('Root'),

    ITEM: item('Item', {
      datastore: 'kv',
      metadata: ItemMeta,
      data: ItemData,
    }),
  },

  links: {},

  appdata: {
    avatar: (m) => ({
      root: module('My Items', m.ROOT),
    }),
  },

  windowState: {
    schema: WindowState,
    initialState: initialWindowState,
  },
})
