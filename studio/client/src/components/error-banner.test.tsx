import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { ErrorBanner } from './error-banner'

const LONG =
  '/classes/principal_administers_company/policies/read [PL_USE] organization.astrale.ai:policy.ObserveCompanyRole is not valid for every concrete source/target pair of read Edge Class principal_administers_company.'

test('the banner shows nothing for no diagnostic, and the first one behind a count for several', () => {
  expect(renderToStaticMarkup(<ErrorBanner messages={['', '   ']} />)).toBe('')
  const html = renderToStaticMarkup(<ErrorBanner messages={[LONG, LONG, LONG]} />)
  expect(html).toContain('+2')
  expect(html.match(/is not valid for every concrete/g)).toHaveLength(1)
})
