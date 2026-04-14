import { TableEntry } from './types'
import { Hashery } from 'hashery'

export const MVT_MIME_TYPE = 'application/vnd.mapbox-vector-tile'
export const PORT_PREFIX = 'devtools-mapbox-vector-tiles-'

export const formatTileId = (entry: TableEntry): string =>
  `{z: ${entry.z}, x: ${entry.x}, y: ${entry.y}}`

export const isTableEntry = (a: unknown): a is TableEntry =>
  typeof a === 'object' && !!a && 'x' in a && 'y' in a && 'z' in a

export const combineHeaders = (headers: { name: string; value: string }[]): Record<string, string> =>
  headers.reduce(
    (collector, { name, value }) => {
      collector[name] = value
      return collector
    },
    {} as Record<string, string>,
  )

export const formatTime = (dateString: string): string => {
  if (!dateString) return ''
  const d = new Date(dateString)
  const pad = (n: number, len = 2) => String(n).padStart(len, '0')
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}`
}

const hasher = new Hashery()

export const hashTableEntry = async (tableEntry: TableEntry): Promise<string> => {
  return await hasher.toHash({
    x: tableEntry.x,
    y: tableEntry.y,
    z: tableEntry.z,
    url: tableEntry.url,
    startedDateTime: tableEntry.startedDateTime,
    startOrder: tableEntry.startOrder,
  })
}
