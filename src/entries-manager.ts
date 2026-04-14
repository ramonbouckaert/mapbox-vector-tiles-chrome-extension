import { VectorTile } from '@mapbox/vector-tile'
import Pbf from 'pbf'
import type { GeoJSON } from 'geojson'
import { TableEntry, TileStatistics } from './types'
import {combineHeaders, formatTileId, hashTableEntry, isTileEmpty, MVT_MIME_TYPE, tileToGeoJson} from './utils'
import { TileStore } from './tile-store'

export class EntriesManager {
  private entries: TableEntry[] = []
  private endOrder = 0
  private startOrder = 0
  private readonly tileStore: TileStore

  trackEmptyResponse = false
  trackOnlySuccessfulResponse = false
  mvtRequestPatternRegExp: RegExp = /[^\s\S]/

  constructor(
    private readonly tabId: string,
    private readonly onAdd: (entry: TableEntry) => Promise<void>,
    private readonly onUpdate: (entry: TableEntry) => Promise<void>,
    private readonly onRemove: (entry: TableEntry) => Promise<void>
  ) {
    this.tileStore = new TileStore(tabId)
  }

  private warnContent(
    entry: TableEntry,
    content: string,
    data: Uint8Array,
    expectedSize: number,
    err?: unknown,
  ): void {
    const message =
      `Cannot read Pbf from Base64 encoded network response (content = ${content}, array = ${data}, size = ${data.length}` +
      (expectedSize !== -1 ? `, expectedSize = ${expectedSize}` : '') +
      `) for tile ${formatTileId(entry)}. Probably the request was aborted while reading of response body.`
    console.warn(
      message +
        (err
          ? ' Details: ' + (typeof err === 'object' && 'stack' in err ? err.stack : err.toString())
          : ''),
    )
    chrome.devtools.inspectedWindow.eval(`console.warn(${JSON.stringify(message)})`)
  }

  private async fetchFromNetwork(entry: TableEntry): Promise<Blob> {
    const headers = { ...entry.headers }
    const acceptKey = Object.keys(headers).find((k) => k.toLowerCase() === 'accept')
    if (acceptKey) headers[acceptKey] = '*/*'
    else headers['Accept'] = '*/*'
    const res = await window.fetch(entry.url, { method: 'GET', headers })
    const blob = new Blob([await res.arrayBuffer()], { type: MVT_MIME_TYPE })
    await this.tileStore.set(await hashTableEntry(entry), blob)
    return blob
  }

  handleNetworkRequest = async (httpEntry: chrome.devtools.network.Request): Promise<void> => {
    const urlParseResult = httpEntry.request.url.match(this.mvtRequestPatternRegExp)
    if (!urlParseResult) return

    const z = urlParseResult.groups?.z ?? urlParseResult[1]
    const x = urlParseResult.groups?.x ?? urlParseResult[2]
    const y = urlParseResult.groups?.y ?? urlParseResult[3]
    if (!z || !x || !y) return

    const pendingEntry: TableEntry = {
      x: parseInt(x),
      y: parseInt(y),
      z: parseInt(z),
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

    httpEntry.getContent(async (content, encoding) => {
      if (!this.entries.includes(pendingEntry)) return

      const isOk = httpEntry.response.status === 200
      const isNoContent = httpEntry.response.status === 204
      const decodedBodySize = httpEntry.response.bodySize || httpEntry.response.content.size

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
            new Blob([data], { type: MVT_MIME_TYPE }),
          )
        }
        await this.onUpdate(pendingEntry)
      }

      const finishEmpty = async (data?: Uint8Array<ArrayBuffer>) => {
        extra.isEmpty = true
        if (!this.trackEmptyResponse) {
          const index = this.entries.indexOf(pendingEntry)
          if (index !== -1) this.entries.splice(index, 1)
          await this.onRemove(pendingEntry)
        }
        await finish(data)
      }

      const finishNotSuccessful = async (data?: Uint8Array<ArrayBuffer>) => {
        extra.isValid = false
        if (this.trackOnlySuccessfulResponse) {
          const index = this.entries.indexOf(pendingEntry)
          if (index !== -1) this.entries.splice(index, 1)
          await this.onRemove(pendingEntry)
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

      let data: Uint8Array<ArrayBuffer>
      if (encoding === 'base64') {
        data = Uint8Array.from(atob(content), (c) => c.charCodeAt(0))
      } else {
        data = new TextEncoder().encode(content)
      }

      if (content === undefined || (decodedBodySize !== -1 && data.length !== decodedBodySize)) {
        this.warnContent(pendingEntry, content, data, decodedBodySize)
        await finishNotSuccessful(data)
        return
      }

      if (!data.length) {
        await finishEmpty(data)
        return
      }

      let tile: VectorTile
      try {
        tile = new VectorTile(new Pbf(data))
      } catch (err) {
        this.warnContent(pendingEntry, content, data, decodedBodySize, err)
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

    const message = `Cannot read Pbf from stored tile ${formatTileId(entry)}. MVT will be fetched again...`
    console.warn(message, ...errors)
    chrome.devtools.inspectedWindow.eval(`console.warn(${JSON.stringify(message)})`)

    try {
      return await this.fetchFromNetwork(entry)
    } catch (error) {
      errors.push(error)
    }

    throw Error(`Loading failed for tile ${formatTileId(entry)}`, { cause: errors })
  }

  async getGeoJsonForEntry(
    entry: TableEntry,
  ): Promise<Record<string, GeoJSON> | { error: string }> {
    try {
      const blob = await this.getBlobForEntry(entry)
      return tileToGeoJson(
        new VectorTile(new Pbf(await blob.arrayBuffer())),
        entry.z,
        entry.x,
        entry.y,
      )
    } catch (error) {
      const message = `... Loading failed for tile ${formatTileId(entry)}`
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
