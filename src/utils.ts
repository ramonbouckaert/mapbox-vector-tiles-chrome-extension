import { DevToolsMessage, ScopedDevToolsMessage, TableEntry } from './types'
import { Hashery } from 'hashery'

export const MVT_MIME_TYPE = 'application/vnd.mapbox-vector-tile'
export const PORT_PREFIX = 'devtools-mapbox-vector-tiles-'

export const formatTileId = (entry: TableEntry): string =>
  `{z: ${entry.z}, x: ${entry.x}, y: ${entry.y}}`

export const isTableEntry = (a: unknown): a is TableEntry =>
  typeof a === 'object' && !!a && 'x' in a && 'y' in a && 'z' in a

export const isDevToolsMessage = (a: unknown): a is DevToolsMessage =>
  typeof a === 'object' && !!a && 'type' in a

export const isScopedDevToolsMessage = (a: unknown, tabId: number): a is ScopedDevToolsMessage =>
  typeof a === 'object' && !!a && 'type' in a && 'tabId' in a && (a as ScopedDevToolsMessage).tabId === tabId

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
