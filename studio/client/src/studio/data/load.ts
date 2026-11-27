/**
 * The Data level's code, loaded apart from the Studio's first paint. Asked for before a dataset
 * opens — the dataset crumb hovered or focused, a Policy carried to a dataset, the Data level
 * routed to — its load leaves the wait; the module loads once, and every later ask gets it.
 */
export const loadDataLevel = () => import('./index')
