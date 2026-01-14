/**
 * Worker Entry
 */

import { initWorker } from "@astrale/react/worker"

import * as endpoints from "./endpoints"
import { App } from "./schema"

initWorker({
  app: App,
  endpoints: Object.values(endpoints),
})
