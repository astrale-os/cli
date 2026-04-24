import { createRoot } from 'react-dom/client'

import './styles.css'
import { App } from './app'

const root = document.getElementById('root')
if (!root) throw new Error('minimal-remote client: #root missing from index.html')

createRoot(root).render(<App />)
