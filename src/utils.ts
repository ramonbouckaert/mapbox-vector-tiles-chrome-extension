import { TableEntry } from './types'
import { Hashery } from 'hashery'

export const MVT_MIME_TYPE = 'application/vnd.mapbox-vector-tile'
export const PORT_PREFIX = 'devtools-mapbox-vector-tiles-'

export const formatTileId = (entry: TableEntry): string =>
  `{z: ${entry.z}, x: ${entry.x}, y: ${entry.y}}`

export const isTableEntry = (a: unknown): a is TableEntry =>
  typeof a === 'object' && !!a && 'x' in a && 'y' in a && 'z' in a

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
