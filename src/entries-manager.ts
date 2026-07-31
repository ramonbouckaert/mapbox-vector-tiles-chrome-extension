import { VectorTile } from '@mapbox/vector-tile'
import { PbfReader } from 'pbf'
import type { GeoJSON } from 'geojson'
import { TableEntry, TileStatistics } from './types'
import {
  combineHeaders,
  extractTileCoords,
  formatTileId,
  hashTableEntry,
  isTileEmpty,
  MAX_TABLE_ENTRIES,
  matchAutomatically,
  MVT_CONTENT_TYPES,
  NEVER_MATCHES,
  normaliseContentType,
  tileToGeoJson,
} from './utils'
import type { MatchMode, TileCoords } from './utils'
import { t } from './i18n'
import { TileStore } from './tile-store'

export class EntriesManager {
  private entries: TableEntry[] = []
  private endOrder = 0
  private startOrder = 0
  private readonly tileStore: TileStore

  // Global state
  trackEmptyResponse = false
  trackOnlySuccessfulResponse = false
  matchMode: MatchMode = 'automatic'
  mvtContentType: string = MVT_CONTENT_TYPES[0]
  mvtRequestPatternRegExp: RegExp = NEVER_MATCHES

  constructor(
    private readonly tabId: string,
    private readonly onAdd: (entry: TableEntry) => Promise<void>,
    private readonly onUpdate: (entry: TableEntry) => Promise<void>,
    private readonly onRemove: (entry: TableEntry) => Promise<void>,
  ) {
    this.tileStore = new TileStore(tabId)
  }

  private warnContent(
    entry: TableEntry,
    data: Uint8Array | undefined,
    expectedSize: number,
    err?: unknown,
  ): void {
    const message = t('warnUnreadableTile', [
      formatTileId(entry),
      data ? String(data.length) : t('valueUnknown'),
      expectedSize !== -1 ? String(expectedSize) : t('valueUnknown'),
    ])
    console.warn(
      message +
        (err
          ? ' Details: ' + (typeof err === 'object' && 'stack' in err ? err.stack : err.toString())
          : ''),
    )
    chrome.devtools.inspectedWindow.eval(`console.warn(${JSON.stringify(message)})`)
  }

  private async removeEntry(entry: TableEntry): Promise<void> {
    const index = this.entries.indexOf(entry)
    if (index !== -1) this.entries.splice(index, 1)
    await this.onRemove(entry)
  }

  // Drops the oldest rows once the table exceeds its cap, discarding their
  // stored tiles too so the object store does not grow unbounded either.
  private async evictOverflow(): Promise<void> {
    while (this.entries.length > MAX_TABLE_ENTRIES) {
      const oldest = this.entries.shift()
      if (!oldest) return
      await this.tileStore.delete(await hashTableEntry(oldest)).catch(() => {})
      await this.onRemove(oldest)
    }
  }

  private async fetchFromNetwork(entry: TableEntry): Promise<Blob> {
    const headers = { ...entry.headers }
    const acceptKey = Object.keys(headers).find((k) => k.toLowerCase() === 'accept')
    if (acceptKey) headers[acceptKey] = '*/*'
    else headers['Accept'] = '*/*'
    const res = await window.fetch(entry.url, { method: 'GET', headers })
    const blob = new Blob([await res.arrayBuffer()], { type: MVT_CONTENT_TYPES[0] })
    await this.tileStore.set(await hashTableEntry(entry), blob)
    return blob
  }

  // Returns the tile's coordinates when the request should be captured, and
  // undefined when it should be ignored. Coordinates can be NaN for a captured
  // tile whose URL carries no z/x/y; those render as "?" in the table.
  private matchRequest(httpEntry: chrome.devtools.network.Request): TileCoords | undefined {
    const url = httpEntry.request.url

    if (this.matchMode === 'urlPattern') {
      const urlParseResult = url.match(this.mvtRequestPatternRegExp)
      if (!urlParseResult) return undefined
      const z = urlParseResult.groups?.z ?? urlParseResult[1]
      const x = urlParseResult.groups?.x ?? urlParseResult[2]
      const y = urlParseResult.groups?.y ?? urlParseResult[3]
      if (!z || !x || !y) return undefined
      return { z: parseInt(z), x: parseInt(x), y: parseInt(y) }
    }

    const mimeType = normaliseContentType(httpEntry.response.content.mimeType)

    if (this.matchMode === 'automatic') return matchAutomatically(mimeType, url)

    const expected = normaliseContentType(this.mvtContentType)
    if (!expected || mimeType !== expected) return undefined
    // No pattern is in play here, so extract z/x/y on a best-effort basis.
    return extractTileCoords(url) ?? { z: NaN, x: NaN, y: NaN }
  }

  handleNetworkRequest = async (httpEntry: chrome.devtools.network.Request): Promise<void> => {
    const coords = this.matchRequest(httpEntry)
    if (!coords) return

    const pendingEntry: TableEntry = {
      x: coords.x,
      y: coords.y,
      z: coords.z,
      status: -1,
      url: httpEntry.request.url,
      headers: combineHeaders(httpEntry.request.headers),
      startOrder: ++this.startOrder,
      startedDateTime: httpEntry.startedDateTime,
      time: httpEntry.time,
      statistics: undefined,
      endOrder: undefined,
      extra: { isPending: true, isValid: false, isEmpty: false },
    }

    this.entries.push(pendingEntry)
    await this.onAdd(pendingEntry)
    await this.evictOverflow()

    httpEntry.getContent(async (content, encoding) => {
      if (!this.entries.includes(pendingEntry)) return

      const isOk = httpEntry.response.status === 200
      const isNoContent = httpEntry.response.status === 204
      // content.size is the decoded body length; bodySize is the on-the-wire
      // (possibly compressed) size, kept only as a fallback.
      const decodedBodySize = httpEntry.response.content.size || httpEntry.response.bodySize

      const statistics: TileStatistics = { layersCount: 0, featuresCount: 0, byLayers: {} }
      const extra = { isPending: false, isValid: isOk || isNoContent, isEmpty: isNoContent }

      const finish = async (data?: Uint8Array<ArrayBuffer>) => {
        Object.assign(pendingEntry, {
          statistics,
          status: httpEntry.response.status,
          tileSize: (extra.isValid && data?.length) || undefined,
          endOrder: ++this.endOrder,
          extra,
        })
        if (data !== undefined) {
          await this.tileStore.set(
            await hashTableEntry(pendingEntry),
            new Blob([data], { type: MVT_CONTENT_TYPES[0] }),
          )
        }
        await this.onUpdate(pendingEntry)
      }

      const finishEmpty = async (data?: Uint8Array<ArrayBuffer>) => {
        extra.isEmpty = true
        if (!this.trackEmptyResponse) await this.removeEntry(pendingEntry)
        await finish(data)
      }

      const finishNotSuccessful = async (data?: Uint8Array<ArrayBuffer>) => {
        extra.isValid = false
        if (this.trackOnlySuccessfulResponse) {
          await this.removeEntry(pendingEntry)
          return
        }
        await finish(data)
      }

      if (!extra.isValid) {
        await finishNotSuccessful()
        return
      }
      if (extra.isEmpty) {
        await finishEmpty()
        return
      }

      if (typeof content !== 'string') {
        this.warnContent(pendingEntry, undefined, decodedBodySize)
        await finishNotSuccessful()
        return
      }

      let data: Uint8Array<ArrayBuffer>
      try {
        data =
          encoding === 'base64'
            ? Uint8Array.from(atob(content), (c) => c.charCodeAt(0))
            : new TextEncoder().encode(content)
      } catch (err) {
        this.warnContent(pendingEntry, undefined, decodedBodySize, err)
        await finishNotSuccessful()
        return
      }

      if (decodedBodySize !== -1 && data.length !== decodedBodySize) {
        this.warnContent(pendingEntry, data, decodedBodySize)
        await finishNotSuccessful(data)
        return
      }

      if (!data.length) {
        await finishEmpty(data)
        return
      }

      let tile: VectorTile
      try {
        tile = new VectorTile(new PbfReader(data))
      } catch (err) {
        this.warnContent(pendingEntry, data, decodedBodySize, err)
        await finishNotSuccessful(data)
        return
      }

      if (isTileEmpty(tile)) {
        await finishEmpty(data)
        return
      }

      Object.keys(tile.layers).forEach((layerName) => {
        const layer = tile.layers[layerName]
        statistics.byLayers[layerName] = { featuresCount: layer?.length }
        if (layer !== undefined) statistics.featuresCount += layer.length
      })
      statistics.layersCount = Object.keys(tile.layers).length

      await finish(data)
    })
  }

  async getBlobForEntry(entry: TableEntry): Promise<Blob> {
    const errors: unknown[] = []

    try {
      const storedBlob = await this.tileStore.get(await hashTableEntry(entry))
      if (storedBlob) return storedBlob
      errors.push(new Error('Tile data could not be found'))
    } catch (error) {
      errors.push(error)
    }

    const message = t('warnStoredTileMissing', formatTileId(entry))
    console.warn(message, ...errors)
    chrome.devtools.inspectedWindow.eval(`console.warn(${JSON.stringify(message)})`)

    try {
      return await this.fetchFromNetwork(entry)
    } catch (error) {
      errors.push(error)
    }

    throw Error(t('errorLoadingTile', formatTileId(entry)), { cause: errors })
  }

  async getGeoJsonForEntry(
    entry: TableEntry,
  ): Promise<Record<string, GeoJSON> | { error: string }> {
    try {
      const blob = await this.getBlobForEntry(entry)
      // Unknown coordinates (NaN) would poison every GeoJSON coordinate, so fall
      // back to 0/0/0 - shapes are preserved, just not geo-referenced.
      return tileToGeoJson(
        new VectorTile(new PbfReader(await blob.arrayBuffer())),
        Number.isFinite(entry.z) ? entry.z : 0,
        Number.isFinite(entry.x) ? entry.x : 0,
        Number.isFinite(entry.y) ? entry.y : 0,
      )
    } catch (error) {
      const message = t('errorLoadingTile', formatTileId(entry))
      console.error(message, error)
      chrome.devtools.inspectedWindow.eval(`console.error(${JSON.stringify(message)})`)
      return { error: message }
    }
  }

  async clear(): Promise<void> {
    await this.tileStore.clearForTab(this.tabId)
    this.entries = []
    this.endOrder = 0
    this.startOrder = 0
  }
}
