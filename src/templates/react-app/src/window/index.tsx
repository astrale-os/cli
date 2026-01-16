/**
 * Window Entry
 */

import { initWindow } from '@astrale/react'

import { App } from '../schema'
import { Main } from './app'

const { render } = initWindow({ app: App })

render(<Main />)
