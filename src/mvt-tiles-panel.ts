import Pbf from 'pbf'
import { VectorTile } from '@mapbox/vector-tile'
import type { Feature, GeoJSON } from 'geojson'
import prettyMilliseconds from 'pretty-ms'
import prettyBytes from 'pretty-bytes'
import { HTMLDivElementWithEntry, TableEntry, TileStatistics } from './types'
import { hashTableEntry, isTableEntry, MVT_MIME_TYPE, formatTileId, PORT_PREFIX, combineHeaders, formatTime } from './utils'
import { createJSONEditor } from 'vanilla-jsoneditor/standalone.js'
import { TileStore } from './tile-store'

// Deps
const tabId = chrome.devtools.inspectedWindow.tabId
const tileStore = new TileStore(String(tabId))
chrome.runtime.connect({ name: `${PORT_PREFIX}${tabId}` })

// Global state
let trackEmptyResponse: boolean
let trackOnlySuccessfulResponse: boolean
let mvtRequestPatternRegExp: RegExp = /[^\s\S]/

// Local state
let entries: TableEntry[] = []
let endOrder = 0
let startOrder = 0
let autoScroll = true
let isAutoScrolling = false

// DOM references
const tilesTable = document.getElementById('tilesTable') as HTMLDivElement
const viewTileContainer = document.getElementById('viewTileContainer') as HTMLDivElement
const dialog = document.getElementById('viewTileDialog')
const closeButton = document.getElementsByClassName('viewTileDialog_closeButton')[0]
const trackEmptyResponseCheckBox = document.getElementById('trackEmptyResponse') as HTMLInputElement
const trackOnlySuccessfulResponseCheckBox = document.getElementById(
  'trackOnlySuccessfulResponse',
) as HTMLInputElement
const mvtRequestPatternText = document.getElementById('mvtRequestPattern') as HTMLInputElement

// Network request functions
const onWrongContent = (
  entry: TableEntry,
  content: string,
  data: Uint8Array,
  contentLengthHeader: number,
  err?: unknown,
) => {
  const message =
    `Cannot read Pbf from Base64 string (content = ${content}, array = ${data}, size = ${data.length}` +
    (contentLengthHeader !== -1 ? `, expectedSize = ${contentLengthHeader}` : '') +
    `) for tile ${formatTileId(entry)}. Probably the request was aborted while reading of response body.`
  console.warn(
    message +
      (err
        ? ' Details: ' + (typeof err === 'object' && 'stack' in err ? err.stack : err.toString())
        : ''),
  )
  chrome.devtools.inspectedWindow.eval(`console.warn(${JSON.stringify(message)})`)
}

const isTileEmpty = (tile: VectorTile): boolean => {
  for (let layerName in tile.layers) {
    const layer = tile.layers[layerName]
    if (layer && layer.length) return false
  }
  return true
}

const onPendingRequest = async (entry: TableEntry) => {
  entries.push(entry)
  await doAutoScrollableOperation(async () => {
    await processPendingEntry(entry)
  })
}

const onFinishedRequest = async (
  oldEntry: TableEntry,
  diff: Partial<TableEntry>,
  tile: Blob | undefined,
) => {
  Object.assign(oldEntry, diff)
  if (tile !== undefined) await tileStore.set(await hashTableEntry(oldEntry), tile)
  await doAutoScrollableOperation(async () => {
    await processFinishedEntry(oldEntry)
  })
}

const onRemoveEntry = async (entry: TableEntry) => {
  const entryIndex = entries.indexOf(entry)
  if (entryIndex !== -1) entries.splice(entryIndex, 1)
  await doAutoScrollableOperation(async () => {
    await processRemovedEntry(entry)
  })
}

// Tile data functions
const fetchTile = async (entry: TableEntry): Promise<Blob> => {
  const headers = { ...entry.headers }
  const acceptKey = Object.keys(headers).find((k) => k.toLowerCase() === 'accept')
  if (acceptKey) {
    headers[acceptKey] = '*/*'
  } else {
    headers['Accept'] = '*/*'
  }
  const res = await window.fetch(entry.url, { method: 'GET', headers })
  const blob = new Blob([await res.arrayBuffer()], { type: MVT_MIME_TYPE })
  await tileStore.set(await hashTableEntry(entry), blob)
  return blob
}

const getBlobForTableEntryWithFallback = async (entry: TableEntry): Promise<Blob> => {
  const errors: unknown[] = []

  try {
    const storedBlob = await tileStore.get(await hashTableEntry(entry))
    if (storedBlob) return storedBlob
    errors.push(new Error('Tile data could not be found'))
  } catch (error) {
    errors.push(error)
  }

  const message = `Cannot read Pbf from stored tile ${formatTileId(entry)}. MVT will be fetched again...`
  console.warn(message, ...errors)
  chrome.devtools.inspectedWindow.eval(`console.warn(${JSON.stringify(message)})`)

  try {
    return await fetchTile(entry)
  } catch (error) {
    errors.push(error)
  }

  throw Error(`Loading failed for tile ${formatTileId(entry)}`, { cause: errors })
}

const tileToGeoJson = (
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

const prepareGeoJsonTile = async (
  entry: TableEntry,
): Promise<Record<string, GeoJSON> | { error: string }> => {
  try {
    const blob = await getBlobForTableEntryWithFallback(entry)
    return tileToGeoJson(new VectorTile(new Pbf(await blob.arrayBuffer())), entry.z, entry.x, entry.y)
  } catch (error) {
    const message = `... Loading failed for tile ${formatTileId(entry)}`
    console.error(message, error)
    chrome.devtools.inspectedWindow.eval(`console.error(${JSON.stringify(message)})`)
    return { error: message }
  }
}

// Table UI functions
const toCell = (div: HTMLDivElement): HTMLDivElement => {
  div.setAttribute('role', 'cell')
  return div
}

const saveFromBinaryData = (arrayBuffer: ArrayBuffer, fileName: string) => {
  const blob = new Blob([arrayBuffer], { type: MVT_MIME_TYPE })
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  window.URL.revokeObjectURL(url)
}

const toMvtLink = (entry: TableEntry): HTMLAnchorElement => {
  const a = document.createElement('a')
  a.setAttribute('href', entry.url)
  a.addEventListener('click', async (e) => {
    e.preventDefault()
    e.stopPropagation()
    try {
      const blob = await getBlobForTableEntryWithFallback(entry)
      saveFromBinaryData(await blob.arrayBuffer(), `${entry.z}_${entry.x}_${entry.y}.mvt`)
    } catch (error) {
      const message = `Loading failed for tile ${formatTileId(entry)}`
      console.error(message, error)
      chrome.devtools.inspectedWindow.eval(`console.error(${JSON.stringify(message)})`)
    }
  })
  const url = new URL(entry.url)
  a.textContent = url.pathname + url.search + url.hash
  return a
}

// DOM manipulation functions
const processPendingEntry = async (entry: TableEntry) => {
  const rowNode = document.createElement('div') as HTMLDivElementWithEntry
  rowNode.setAttribute('entry-hash', await hashTableEntry(entry))
  rowNode.entry = entry
  rowNode.setAttribute('role', 'row')
  tilesTable.appendChild(rowNode)

  const addCell = () => {
    const cell = toCell(document.createElement('div'))
    rowNode.appendChild(cell)
    return cell
  }

  const statusNode = addCell()
  const zNode = addCell()
  const xNode = addCell()
  const yNode = addCell()
  addCell() // bytes — empty for pending
  const urlNode = addCell()
  addCell() // layers count — empty for pending
  const featuresCountNode = addCell()
  const startDateNode = addCell()
  const nEndedNode = addCell()
  const durationNode = addCell()

  statusNode.textContent = entry.status?.toString()
  urlNode.appendChild(toMvtLink(entry))
  zNode.textContent = String(entry.z)
  xNode.textContent = String(entry.x)
  yNode.textContent = String(entry.y)
  startDateNode.textContent = `${entry.startOrder} | ${formatTime(entry.startedDateTime)}`
  durationNode.textContent = entry.time ? prettyMilliseconds(Math.round(entry.time)) : ''
  nEndedNode.textContent = String(entry.endOrder || '')
  featuresCountNode.classList.add('wrap-content')
  rowNode.classList.add('pending-tile')
}

const processFinishedEntry = async (entry: TableEntry) => {
  const entryHash = await hashTableEntry(entry)
  const rowNode = tilesTable.querySelector(`[entry-hash="${entryHash}"]`) as HTMLDivElementWithEntry | null
  if (!rowNode) return

  const statusNode = rowNode.children[0]
  const bytesNode = rowNode.children[4]
  const layersCountNode = rowNode.children[6]
  const featuresCountNode = rowNode.children[7]
  const nEndedNode = rowNode.children[9]

  if (statusNode) statusNode.textContent = entry.status?.toString()
  if (bytesNode) bytesNode.textContent = entry.tileSize ? prettyBytes(entry.tileSize) : ''
  if (nEndedNode) nEndedNode.textContent = String(entry.endOrder || '')

  rowNode.classList.remove('pending-tile')

  if (entry.extra.isValid) {
    rowNode.entry = entry
    const statistics = entry.statistics
    if (statistics) {
      if (entry.extra.isEmpty || !statistics.featuresCount) rowNode.classList.add('empty-tile')
      if (layersCountNode)
        layersCountNode.textContent = statistics.layersCount ? String(statistics.layersCount) : ''
      if (featuresCountNode)
        featuresCountNode.textContent = Object.keys(statistics.byLayers)
          .map((layerName) => `${layerName}: ${statistics.byLayers[layerName]?.featuresCount}`)
          .join('\n')
    }
  } else {
    rowNode.classList.add('no-success-tile')
  }
}

const processRemovedEntry = async (entry: TableEntry) => {
  const entryHash = await hashTableEntry(entry)
  tilesTable.querySelector(`[entry-hash="${entryHash}"]`)?.remove()
}

const doAutoScrollableOperation = async (operation: () => Promise<void>) => {
  await operation()
  if (autoScroll) {
    isAutoScrolling = true
    tilesTable.scrollTo({ top: tilesTable.scrollHeight, behavior: 'smooth' })
  }
}

const onClear = async () => {
  await tileStore.clearForTab(String(tabId))
  entries = []
  endOrder = 0
  startOrder = 0
  tilesTable.querySelectorAll('[role=row]').forEach((row) => row.remove())
}

// Misc helper functions
//http://qaru.site/questions/88685/auto-scaling-inputtype-text-to-width-of-value
const getTextWidth = (text: string, fontSize: string, fontName: string, fontWeight: string) => {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (context) {
    context.font = fontWeight + ' ' + fontSize + ' ' + fontName
    return context.measureText(text).width
  }
}

const adjustInputTextWidth = (input: HTMLInputElement) => {
  const style = window.getComputedStyle(input)
  const textWidth = getTextWidth(input.value, style.fontSize, style.fontFamily, style.fontWeight)
  if (textWidth) input.style.width = textWidth + 20 + 'px'
}

const updateControls = (
  trackEmptyResponse: boolean,
  trackOnlySuccessfulResponse: boolean,
  mvtRequestPattern: string,
) => {
  trackEmptyResponseCheckBox.checked = Boolean(trackEmptyResponse)
  trackOnlySuccessfulResponseCheckBox.checked = Boolean(trackOnlySuccessfulResponse)
  mvtRequestPatternText.value = mvtRequestPattern
  adjustInputTextWidth(mvtRequestPatternText)
}

const updateSettings = () => {
  chrome.storage.local.set(
    {
      trackEmptyResponse: trackEmptyResponseCheckBox.checked,
      trackOnlySuccessfulResponse: trackOnlySuccessfulResponseCheckBox.checked,
      mvtRequestPattern: mvtRequestPatternText.value,
    },
    () => {},
  )
}

// Setup
chrome.storage.local.get(
  ['trackEmptyResponse', 'trackOnlySuccessfulResponse', 'mvtRequestPattern'],
  async (r) => {
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
    updateControls(
      Boolean(r.trackEmptyResponse),
      Boolean(r.trackOnlySuccessfulResponse),
      r.mvtRequestPattern as string,
    )

    await tileStore.clearForTab(String(tabId))

    chrome.devtools.network.onRequestFinished.addListener(async (httpEntry) => {
      const urlParseResult = httpEntry.request.url.match(mvtRequestPatternRegExp)

      if (!urlParseResult) return

      const z = (urlParseResult.groups && urlParseResult.groups.z) || urlParseResult[1]
      const x = (urlParseResult.groups && urlParseResult.groups.x) || urlParseResult[2]
      const y = (urlParseResult.groups && urlParseResult.groups.y) || urlParseResult[3]

      if (!z || !x || !y) return

      const pendingEntry: TableEntry = {
        x: parseInt(x),
        y: parseInt(y),
        z: parseInt(z),
        status: -1,
        url: httpEntry.request.url,
        headers: combineHeaders(httpEntry.request.headers),
        startOrder: ++startOrder,
        startedDateTime: httpEntry.startedDateTime,
        time: httpEntry.time,
        statistics: undefined,
        endOrder: undefined,
        extra: { isPending: true, isValid: false, isEmpty: false },
      }
      await onPendingRequest(pendingEntry)

      httpEntry.getContent(async (content, encoding) => {
        const decodedBodySize = httpEntry.response.bodySize || httpEntry.response.content.size
        if (entries.indexOf(pendingEntry) === -1) return

        const isOk = httpEntry.response.status === 200
        const isNoContent = httpEntry.response.status === 204
        const isValid = isOk || isNoContent

        const statistics: TileStatistics = { layersCount: 0, featuresCount: 0, byLayers: {} }
        const extra = { isPending: false, isValid, isEmpty: isNoContent }

        const requestFinished = async (data?: Uint8Array<ArrayBuffer>) => {
          await onFinishedRequest(
            pendingEntry,
            {
              ...pendingEntry,
              statistics,
              status: httpEntry.response.status,
              tileSize: (extra.isValid && data && data.length) || undefined,
              endOrder: ++endOrder,
              extra,
            },
            data ? new Blob([data], { type: MVT_MIME_TYPE }) : undefined,
          )
        }

        const emptyRequestFinished = async (data?: Uint8Array<ArrayBuffer>) => {
          extra.isEmpty = true
          if (!trackEmptyResponse) await onRemoveEntry(pendingEntry)
          await requestFinished(data)
        }

        const notSuccessfulRequestFinished = async (data?: Uint8Array<ArrayBuffer>) => {
          extra.isValid = false
          if (trackOnlySuccessfulResponse) {
            await onRemoveEntry(pendingEntry)
            return
          }
          await requestFinished(data)
        }

        if (!extra.isValid) {
          await notSuccessfulRequestFinished()
          return
        }

        if (extra.isEmpty) {
          await emptyRequestFinished()
          return
        }

        let data: Uint8Array<ArrayBuffer>
        if (encoding === 'base64') {
          data = Uint8Array.from(atob(content), (c) => c.charCodeAt(0))
        } else {
          data = new TextEncoder().encode(content)
        }

        if (content === undefined || (decodedBodySize !== -1 && data.length !== decodedBodySize)) {
          onWrongContent(pendingEntry, content, data, decodedBodySize)
          await notSuccessfulRequestFinished(data)
          return
        }

        if (!data.length) {
          await emptyRequestFinished(data)
          return
        }

        let tile: VectorTile
        try {
          tile = new VectorTile(new Pbf(data))
        } catch (err) {
          onWrongContent(pendingEntry, content, data, decodedBodySize, err)
          await notSuccessfulRequestFinished(data)
          return
        }

        if (isTileEmpty(tile)) {
          await emptyRequestFinished(data)
          return
        }

        Object.keys(tile.layers).forEach((layerName) => {
          const layer = tile.layers[layerName]
          statistics.byLayers[layerName] = { featuresCount: layer?.length }
          if (layer !== undefined) statistics.featuresCount += layer.length
        })
        statistics.layersCount = Object.keys(tile.layers).length

        await requestFinished(data)
      })
    })
  },
)

// Handle changes to global state
chrome.storage.local.onChanged.addListener((changes) => {
  if (changes['trackEmptyResponse']) {
    trackEmptyResponse = !!changes['trackEmptyResponse'].newValue
    trackEmptyResponseCheckBox.checked = Boolean(changes['trackEmptyResponse'].newValue)
  }
  if (changes['trackOnlySuccessfulResponse']) {
    trackOnlySuccessfulResponse = !!changes['trackOnlySuccessfulResponse'].newValue
    trackOnlySuccessfulResponseCheckBox.checked = Boolean(
      changes['trackOnlySuccessfulResponse'].newValue,
    )
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
    mvtRequestPatternText.value = String(changes['mvtRequestPattern'].newValue)
  }
})

// Register DOM event listeners
tilesTable.addEventListener('scroll', () => {
  if (!isAutoScrolling)
    autoScroll = tilesTable.scrollHeight - tilesTable.scrollTop - tilesTable.offsetHeight < 5
})
tilesTable.addEventListener('scrollend', () => {
  isAutoScrolling = false
})

closeButton?.addEventListener('click', () => {
  if (dialog) dialog.style.display = 'none'
})

document.getElementById('clear')?.addEventListener('click', async (e) => {
  e.preventDefault()
  await onClear()
})

trackEmptyResponseCheckBox.addEventListener('change', updateSettings)
trackOnlySuccessfulResponseCheckBox.addEventListener('change', updateSettings)
mvtRequestPatternText.addEventListener('keyup', () => {
  adjustInputTextWidth(mvtRequestPatternText)
  updateSettings()
})

document.addEventListener('click', async (e: MouseEvent) => {
  const dialogIsHidden = dialog
    ? window.getComputedStyle(dialog).getPropertyValue('display') === 'none'
    : true
  if (dialogIsHidden) {
    let node = e.target
    while (
      node &&
      node instanceof Element &&
      'role' in node &&
      node.role !== 'row' &&
      node.parentElement !== tilesTable
    ) {
      node = node.parentElement
    }
    if (dialog) dialog.style.display = 'none'
    const entry = (node && node instanceof Element && 'entry' in node && node.entry) || undefined
    if (isTableEntry(entry)) {
      const isLarge = entry.tileSize ? entry.tileSize > 200_000 : true
      viewTileContainer.innerHTML = isLarge
        ? `<div id="loadingIndicator">Loading tile as JSON${entry.tileSize ? ` (original size ${prettyBytes(entry.tileSize)})` : ''}...</div>`
        : ''
      const geoJsonOrJsonError = await prepareGeoJsonTile(entry)
      if (dialog) dialog.style.display = 'block'
      // If the tile is large, await an animation frame to ensure the dialog has been opened with the loading indicator
      if (isLarge) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))
        viewTileContainer.innerHTML = ''
      }
      setTimeout(() => {
        createJSONEditor({
          target: viewTileContainer,
          props: {
            mode: 'text',
            mainMenuBar: false,
            content: { json: { ...entry, extra: undefined, tile: geoJsonOrJsonError } },
            readOnly: true,
            maxDocumentSizeTextMode: Infinity,
          },
        })
      }, 0)
    }
  } else {
    if (e.target === dialog) {
      viewTileContainer.innerHTML = ''
      if (dialog) dialog.style.display = 'none'
    }
  }
})
