import { defineDataset } from '@astrale-os/sdk/testing'

import { StudioE2ESchema } from '../../schema/index.js'

/** A dataset its own Schema refuses: the Edge names a Node the dataset never adds. */
export default defineDataset(StudioE2ESchema, {
  id: 'broken',
  title: 'Broken on purpose',
  graph({ classes, node, edge }) {
    const acme = node(classes.Company, {
      id: 'acme',
      props: { displayName: 'Acme', legalName: 'Acme SAS', country: 'FR' },
    })
    edge(classes.WorksAt, 'nobody', acme)
  },
})
