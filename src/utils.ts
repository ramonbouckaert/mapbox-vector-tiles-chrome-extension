import type { TableEntry } from './types'
import { Hashery } from 'hashery'
import type { VectorTile } from '@mapbox/vector-tile'
import type { Feature, GeoJSON } from 'geojson'

export const PORT_PREFIX = 'devtools-mapbox-vector-tiles-'

// Oldest rows are dropped past this point so a long panning session cannot grow
// the table (and its backing store) without bound.
export const MAX_TABLE_ENTRIES = 1000

// Matches nothing - used until a pattern is configured, and whenever the pattern
// box is left empty.
export const NEVER_MATCHES = /[^\s\S]/

// Suggested values offered by the "Capture by" autocomplete. The first entry of
// each list is also the default used when nothing has been configured yet.
export const MVT_CONTENT_TYPES = [
  'application/vnd.mapbox-vector-tile',
  'application/x-protobuf',
  'application/protobuf',
  'application/vnd.google.protobuf',
  'application/octet-stream',
] as const

export const MVT_REQUEST_PATTERNS = [
  '.*\\/(?<z>\\d+)\\/(?<x>\\d+)\\/(?<y>\\d+)\\.mvt[^\\/]*$',
  '.*\\/(?<z>\\d+)\\/(?<x>\\d+)\\/(?<y>\\d+)[^\\/]*$',
  '.*\\/(?<z>\\d+)\\/(?<x>\\d+)\\/(?<y>\\d+)\\.pbf[^\\/]*$',
  '.*\\/(?<z>\\d+)\\/(?<x>\\d+)\\/(?<y>\\d+)\\.(?:mvt|pbf|vector\\.pbf)[^\\/]*$',
  '.*\\/(?<z>\\d+)\\/(?<x>\\d+)\\/(?<y>\\d+)(?:@\\d+x)?\\.(?:mvt|pbf)[^\\/]*$',
] as const

export const isTileEmpty = (tile: VectorTile): boolean => {
  for (const layerName in tile.layers) {
    const layer = tile.layers[layerName]
    if (layer && layer.length) return false
  }
  return true
}

export const tileToGeoJson = (
  tile: VectorTile,
  z: number,
  x: number,
  y: number,
): Record<string, GeoJSON> => {
  const layerNames = Object.keys(tile.layers)
  if (!layerNames.length) return {}
  return layerNames.reduce((acc: Record<string, GeoJSON>, layerName: string) => {
    const layer = tile.layers[layerName]
    if (!layer) return acc
    const features: Feature[] = []
    for (let i = 0; i < layer.length; i++) {
      features.push(layer.feature(i).toGeoJSON(x, y, z))
    }
    return { ...acc, [layerName]: { type: 'FeatureCollection' as const, features } }
  }, {})
}

// Coordinates are NaN when a content-type-matched URL has no recognisable z/x/y.
export const formatCoord = (n: number): string => (Number.isFinite(n) ? String(n) : '?')

export const formatTileId = (entry: TableEntry): string =>
  `{z: ${formatCoord(entry.z)}, x: ${formatCoord(entry.x)}, y: ${formatCoord(entry.y)}}`

// Three slash-separated numbers appearing anywhere in the URL. Each number must
// be a whole path segment, so "/data/v3/14/1234/5678.pbf" yields 14/1234/5678
// rather than starting mid-segment at the "3" of "v3".
const TILE_COORDS_REGEXP = /(?:^|\/)(\d+)\/(\d+)\/(\d+)(?!\d)/g

export const extractTileCoords = (url: string): { z: number; x: number; y: number } | undefined => {
  // Best-effort extraction: prefer the last (deepest) triple, since leading path
  // segments are more likely to be version or account numbers.
  const matches = [...url.matchAll(TILE_COORDS_REGEXP)]
  const last = matches[matches.length - 1]
  if (!last) return undefined
  return { z: parseInt(last[1] ?? ''), x: parseInt(last[2] ?? ''), y: parseInt(last[3] ?? '') }
}

// Coordinates are not always known in content-type mode, so fall back to the
// URL's last path segment rather than emitting a "NaN_NaN_NaN.mvt" download.
export const tileFileName = (entry: TableEntry): string => {
  if ([entry.z, entry.x, entry.y].every((n) => Number.isFinite(n))) {
    return `${entry.z}_${entry.x}_${entry.y}.mvt`
  }
  let lastSegment: string | undefined
  try {
    lastSegment = new URL(entry.url).pathname.split('/').filter(Boolean).pop()
  } catch {
    lastSegment = undefined
  }
  const base = (lastSegment ?? '').replace(/\.[^.]*$/, '').replace(/[^\w.-]+/g, '_')
  return `${base || 'tile'}.mvt`
}

export const isTableEntry = (a: unknown): a is TableEntry =>
  typeof a === 'object' && !!a && 'x' in a && 'y' in a && 'z' in a

export const combineHeaders = (
  headers: { name: string; value: string }[],
): Record<string, string> =>
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
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
}

const hasher = new Hashery()

// Memoized per entry object - the hashed fields never change after creation.
const hashCache = new WeakMap<TableEntry, Promise<string>>()

export const hashTableEntry = (tableEntry: TableEntry): Promise<string> => {
  let hash = hashCache.get(tableEntry)
  if (!hash) {
    hash = hasher.toHash({
      x: tableEntry.x,
      y: tableEntry.y,
      z: tableEntry.z,
      url: tableEntry.url,
      startedDateTime: tableEntry.startedDateTime,
      startOrder: tableEntry.startOrder,
    })
    hashCache.set(tableEntry, hash)
  }
  return hash
}
