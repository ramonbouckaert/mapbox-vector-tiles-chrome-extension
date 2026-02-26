import { VectorTile } from '@mapbox/vector-tile'
import Pbf from 'pbf'
import { DevToolsMessage, TableEntry, TileStatistics } from './types'
import {isDevToolsMessage} from "./utils";

let entries: TableEntry[] = []
let endOrder = 0
let startOrder = 0

const sendMessage = async (message: DevToolsMessage) => {
  await chrome.runtime.sendMessage(message)
}

const redrawEntries = async () => {
  await sendMessage({ type: 'REDRAW_ENTRIES', entries })
}

const onPendingRequest = async (entry: TableEntry) => {
  entries.push(entry)
  await sendMessage({ type: 'PENDING_ENTRY', entry })
}

const onFinishedRequest = async (oldEntry: TableEntry, diff: Partial<TableEntry>) => {
  Object.assign(oldEntry, diff)
  await sendMessage({ type: 'FINISHED_ENTRY', entry: oldEntry })
}

const onRemoveEntry = async (entry: TableEntry) => {
  const entryIndex = entries.indexOf(entry)
  if (entryIndex !== -1) {
    entries.splice(entryIndex, 1)
  }
  await sendMessage({ type: 'REMOVED_ENTRY', entry })
}

const handleMessage = async (message: DevToolsMessage) => {
  switch (message.type) {
    case 'CLEAR':
      entries = []
      endOrder = 0
      startOrder = 0
      await redrawEntries()
      return
  }
}

chrome.runtime.onMessage.addListener(async (message: unknown) => {
  if (isDevToolsMessage(message)) {
    await handleMessage(message)
  }
})

const onWrongContent = (
  entry: TableEntry,
  content: string,
  data: Uint8Array,
  contentLengthHeader: number,
  err?: unknown,
) => {
  const message =
    'Cannot read Pbf from Base64 string (' +
    'content = ' +
    content +
    ', ' +
    'array = ' +
    data +
    ', size = ' +
    data.length +
    (contentLengthHeader !== -1 ? ', expectedSize = ' + contentLengthHeader : '') +
    ') for tile {z: ' +
    entry.z +
    ', x: ' +
    entry.x +
    ', y: ' +
    entry.y +
    '}. ' +
    'Probably the request was aborted while reading of response body.'
  console.warn(
    message +
      (err
        ? ' Details: ' + (typeof err === 'object' && 'stack' in err ? err.stack : err.toString())
        : ''),
  )
  chrome.devtools.inspectedWindow.eval("console.warn('" + message + "')")
}

const isTileEmpty = (tile: VectorTile): boolean => {
  for (let layerName in tile.layers) {
    const layer = tile.layers[layerName]
    if (layer.length) {
      return false
    }
  }
  return true
}

const combineHeaders = (headers: { name: string; value: string }[]): Record<string, string> => {
  return headers
    ? headers.reduce(
        (collector, nameValue) => {
          collector[nameValue.name] = nameValue.value
          return collector
        },
        {} as Record<string, string>,
      )
    : {}
}

let trackEmptyResponse: boolean
let trackOnlySuccessfulResponse: boolean
let mvtRequestPatternRegExp: RegExp

chrome.storage.local.onChanged.addListener((changes) => {
  if (changes['trackEmptyResponse']) {
    trackEmptyResponse = !!changes['trackEmptyResponse'].newValue
  }
  if (changes['trackOnlySuccessfulResponse']) {
    trackOnlySuccessfulResponse = !!changes['trackOnlySuccessfulResponse'].newValue
  }
  if (changes['mvtRequestPattern']) {
    const mvtRequestPattern = changes['mvtRequestPattern'].newValue?.toString()
    if (mvtRequestPattern) {
      try {
        mvtRequestPatternRegExp = new RegExp(mvtRequestPattern, 'i')
      } catch (e) {
        console.log('Mvt Request Pattern is invalid', mvtRequestPattern)
      }
    } else console.log('Mvt Request Pattern is invalid', mvtRequestPattern)
  }
})

chrome.storage.local.get(
  ['trackEmptyResponse', 'trackOnlySuccessfulResponse', 'mvtRequestPattern'],
  (r) => {
    trackEmptyResponse = Boolean(r.trackEmptyResponse)
    trackOnlySuccessfulResponse = Boolean(r.trackOnlySuccessfulResponse)
    const mvtRequestPattern = r.mvtRequestPattern?.toString()
    if (mvtRequestPattern) {
      try {
        mvtRequestPatternRegExp = new RegExp(mvtRequestPattern, 'i')
      } catch (e) {
        console.log('Mvt Request Pattern is invalid', r.mvtRequestPattern)
      }
    }

    chrome.devtools.panels.create('Mapbox Vector Tiles', 'images/16.png', 'mvt-tiles-panel.html')

    chrome.devtools.network.onRequestFinished.addListener(async (httpEntry) => {
      const urlParseResult = httpEntry.request.url.match(mvtRequestPatternRegExp)

      if (!urlParseResult) {
        return
      }

      const z = (urlParseResult.groups && urlParseResult.groups.z) || urlParseResult[1]
      const x = (urlParseResult.groups && urlParseResult.groups.x) || urlParseResult[2]
      const y = (urlParseResult.groups && urlParseResult.groups.y) || urlParseResult[3]

      if (!z || !x || !y) {
        return
      }

      let nStarted = ++startOrder

      //http://qnimate.com/detecting-end-of-scrolling-in-html-element/
      //https://stackoverflow.com/questions/8773921/how-to-automatically-scroll-down-a-html-page
      const time = httpEntry.time
      const startedDateTime = httpEntry.startedDateTime
      const url = httpEntry.request.url

      const requestHeaders = combineHeaders(httpEntry.request.headers)

      const pendingEntry = {
        x: parseInt(x),
        y: parseInt(y),
        z: parseInt(z),
        status: -1,
        url: url,
        headers: requestHeaders,
        startOrder: nStarted,
        startedDateTime: startedDateTime,
        time: time,
        statistics: undefined,
        tile: undefined,
        endOrder: undefined,
        extra: { isPending: true, isValid: false, isEmpty: false },
      }
      await onPendingRequest(pendingEntry)

      httpEntry.getContent(async (content, encoding) => {
        const decodedBodySize = httpEntry.response.bodySize || httpEntry.response.content.size
        const pendingEntryIndex = entries.indexOf(pendingEntry)
        if (pendingEntryIndex === -1) {
          return
        }

        const isOk = httpEntry.response.status === 200
        const isNoContent = httpEntry.response.status === 204
        const isValid = isOk || isNoContent

        const layersStatistics = {}
        const statistics: TileStatistics = {
          layersCount: 0,
          featuresCount: 0,
          byLayers: layersStatistics,
        }
        const extra = { isPending: false, isValid: isValid, isEmpty: isNoContent }

        const requestFinished = async () => {
          await onFinishedRequest(pendingEntry, {
            ...pendingEntry,
            statistics: statistics,
            status: httpEntry.response.status,
            tile: content,
            tileSize: (extra.isValid && data && data.length) || undefined,
            endOrder: ++endOrder,
            extra: extra,
          })
        }

        const emptyRequestFinished = async () => {
          extra.isEmpty = true
          if (!trackEmptyResponse) {
            await onRemoveEntry(pendingEntry)
          }
          await requestFinished()
        }

        const notSuccessfulRequestFinished = async () => {
          extra.isValid = false
          if (trackOnlySuccessfulResponse) {
            await onRemoveEntry(pendingEntry)
            return
          }
          await requestFinished()
        }

        if (!extra.isValid) {
          await notSuccessfulRequestFinished()
          return
        }

        if (extra.isEmpty) {
          await emptyRequestFinished()
          return
        }

        let data: Uint8Array
        if (encoding === 'base64') {
          data = Uint8Array.from(atob(content), (c) => c.charCodeAt(0))
        } else {
          data = new TextEncoder().encode(content)
        }

        if (content == undefined || (decodedBodySize !== -1 && data.length !== decodedBodySize)) {
          onWrongContent(pendingEntry, content, data, decodedBodySize)
          await notSuccessfulRequestFinished()
          return
        }

        if (!data.length) {
          await emptyRequestFinished()
          return
        }

        let tile: VectorTile

        try {
          tile = new VectorTile(new Pbf(data))
        } catch (err) {
          onWrongContent(pendingEntry, content, data, decodedBodySize, err)
          await notSuccessfulRequestFinished()
          return
        }

        if (isTileEmpty(tile)) {
          await emptyRequestFinished()
          return
        }

        const layersNames = Object.keys(tile.layers)
        layersNames.forEach((layerName) => {
          const layer = tile.layers[layerName]
          const layerStatistics: { featuresCount?: number } = (statistics.byLayers[layerName] = {})
          layerStatistics.featuresCount = layer.length
          statistics.featuresCount += layer.length
        })
        statistics.layersCount = layersNames.length

        await requestFinished()
      })
    })
  },
)
