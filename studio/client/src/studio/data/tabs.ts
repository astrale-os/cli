/**
 * The questions the Data level answers about a dataset, as its tabs name them. They are the Data
 * level's own: a Schema is read through lenses (`lenses/keys.ts`), a dataset through these.
 *
 * - Query: what the dataset holds, a part at a time, through the Queries the Domain declares.
 * - Access: who may read what and do what on it, by which rule, as any of its identities.
 * - Scenarios: the answers kept as expected, judged again whenever the Schema or the dataset changes.
 */

export const DATA_TABS = ['query', 'access', 'scenarios'] as const

export type DataTab = (typeof DATA_TABS)[number]

export interface DataTabName {
  id: DataTab
  label: string
  /** the question it answers */
  question: string
  /** its keyboard shortcut */
  shortcut: string
}

export const DATA_TAB_NAMES: readonly DataTabName[] = [
  {
    id: 'query',
    label: 'Query',
    question: 'What the dataset holds, asked a part at a time',
    shortcut: '1',
  },
  {
    id: 'access',
    label: 'Access',
    question: 'Who may read and do what, and by which rule',
    shortcut: '2',
  },
  {
    id: 'scenarios',
    label: 'Scenarios',
    question: 'What is expected to stay allowed or refused',
    shortcut: '3',
  },
]

export const dataTabName = (id: DataTab): DataTabName =>
  DATA_TAB_NAMES.find((tab) => tab.id === id)!

export const isDataTab = (value: string | null | undefined): value is DataTab =>
  value !== null && value !== undefined && (DATA_TABS as readonly string[]).includes(value)
