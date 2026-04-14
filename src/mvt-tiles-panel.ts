import Pbf from 'pbf'
import {VectorTile} from '@mapbox/vector-tile'
import type {Feature, GeoJSON} from 'geojson'
import prettyMilliseconds from 'pretty-ms'
import prettyBytes from 'pretty-bytes'
import {DevToolsMessage, HTMLDivElementWithEntry, TableEntry,} from './types'
import {hashTableEntry, isDevToolsMessage, isTableEntry} from "./utils";
import { createJSONEditor } from 'vanilla-jsoneditor/standalone.js'
import {TileStore} from "./tile-store";

const tileStore = new TileStore();

const tilesTable = document.getElementById('tilesTable') as HTMLDivElement
const viewTileContainer = document.getElementById('viewTileContainer') as HTMLDivElement

const dialog = document.getElementById('viewTileDialog')
const closeButton = document.getElementsByClassName('viewTileDialog_closeButton')[0]
closeButton?.addEventListener('click', () => {
  if (dialog) dialog.style.display = 'none'
})

const sendMessage = async (message: DevToolsMessage) => {
  await chrome.runtime.sendMessage(message)
}

const onClear = async () => {
  await sendMessage({ type: 'CLEAR' })
}

const handleMessage = async (message: DevToolsMessage): Promise<void> => {
  switch (message.type) {
    case 'PENDING_ENTRY':
      await doAutoScrollableOperation(async () => {
        await processPendingEntry(message.entry)
      })
      return
    case 'FINISHED_ENTRY':
      await doAutoScrollableOperation(async () => {
        await processFinishedEntry(message.entry)
      })
      return
    case 'REMOVED_ENTRY':
      await doAutoScrollableOperation(async () => {
        await processRemovedEntry(message.entry)
      })
      return
    case 'REDRAW_ENTRIES':
      await doAutoScrollableOperation(async () => {
        tilesTable.querySelectorAll('[role=row]').forEach((row) => row.remove())
        message.entries.forEach((entry) => {
          processPendingEntry(entry)
          if (entry.status !== -1 /*pending*/) {
            processFinishedEntry(entry)
          }
        })
      })
      return
  }
}

chrome.runtime.onMessage.addListener(async (message: unknown) => {
  if (isDevToolsMessage(message)) {
    await handleMessage(message)
  }
})

document.getElementById('clear')?.addEventListener('click', async (e) => {
  e.preventDefault()
  await onClear()
  return false
})

const trackEmptyResponseCheckBox = document.getElementById('trackEmptyResponse') as HTMLInputElement
const trackOnlySuccessfulResponseCheckBox = document.getElementById(
  'trackOnlySuccessfulResponse',
) as HTMLInputElement
const mvtRequestPatternText = document.getElementById('mvtRequestPattern') as HTMLInputElement

//http://qaru.site/questions/88685/auto-scaling-inputtype-text-to-width-of-value
const getTextWidth = (text: string, fontSize: string, fontName: string, fontWeight: string) => {
  let canvas = document.createElement('canvas')
  let context = canvas.getContext('2d')
  if (context) {
    context.font = fontWeight + ' ' + fontSize + ' ' + fontName
    return context.measureText(text).width
  }
}

const tileToGeoJson = (
  tile: VectorTile,
  z: number,
  x: number,
  y: number,
): Record<string, GeoJSON> => {
  const layerNames = Object.keys(tile.layers)
  if (!layerNames.length) {
    return {}
  }
  return layerNames.reduce((acc: Record<string, GeoJSON>, layerName: string) => {
    const layer = tile.layers[layerName]
    if (!layer) return acc

    const features: Feature[] = []
    for (let i = 0; i < layer.length; i++) {
      features.push(layer.feature(i).toGeoJSON(x, y, z))
    }
    return {
      ...acc,
      [layerName]: {
        type: 'FeatureCollection' as const,
        features,
      },
    }
  }, {})
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

chrome.storage.local.get(
  ['trackEmptyResponse', 'trackOnlySuccessfulResponse', 'mvtRequestPattern'],
  ({ trackEmptyResponse, trackOnlySuccessfulResponse, mvtRequestPattern }) => {
    updateControls(
      trackEmptyResponse as boolean,
      trackOnlySuccessfulResponse as boolean,
      mvtRequestPattern as string,
    )
  },
)

chrome.storage.local.onChanged.addListener((changes) => {
  if (changes['trackEmptyResponse']) {
    trackEmptyResponseCheckBox.checked = Boolean(changes['trackEmptyResponse'].newValue)
  }
  if (changes['trackOnlySuccessfulResponse']) {
    trackOnlySuccessfulResponseCheckBox.checked = Boolean(
      changes['trackOnlySuccessfulResponse'].newValue,
    )
  }
  if (changes['mvtRequestPattern']) {
    mvtRequestPatternText.value = String(changes['mvtRequestPattern'].newValue)
  }
})

trackEmptyResponseCheckBox.addEventListener('change', updateSettings)
trackOnlySuccessfulResponseCheckBox.addEventListener('change', updateSettings)
mvtRequestPatternText.addEventListener('keyup', () => {
  adjustInputTextWidth(mvtRequestPatternText)
  updateSettings()
})

const onDocumentClick = (e: MouseEvent) => {
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
    viewTileContainer.innerHTML = ''
    if (dialog) dialog.style.display = 'none'
    const entry = (node && node instanceof Element && 'entry' in node && node.entry) || undefined
    if (isTableEntry(entry)) {
      setTimeout(async () => {
        const geoJsonOrJsonError = await prepareGeoJsonTile(entry)
        if (dialog) dialog.style.display = 'block'
        createJSONEditor({
          target: viewTileContainer,
          props: {
            mode: "text",
            mainMenuBar: false,
            content: { json: createViewContent(entry, geoJsonOrJsonError) },
            readOnly: true
          }
        })
      }, 0) /*to see that previous content is cleared*/
    }
  } else {
    if (e.target === dialog) {
      viewTileContainer.innerHTML = ''
      if (dialog) dialog.style.display = 'none'
    }
  }
}

document.addEventListener('click', onDocumentClick)

const getBlobForTableEntry = async (
  entry: TableEntry
): Promise<Blob> => {
  const storedBlob = await tileStore.get(await hashTableEntry(entry));

  if (!storedBlob) throw Error("Tile data could not be found");

  return storedBlob;
}

const getBlobForTableEntryWithFallback = async (
  entry: TableEntry
): Promise<Blob> => {
  let blob: Blob | undefined;
  const errors: unknown[] = [];

  try {
    blob = await getBlobForTableEntry(entry);
  } catch (error) {
    errors.push(error);
    const message =
      'Cannot read Pbf from stored tile' +
      '{z: ' + entry.z + ', x: ' + entry.x + ', y: ' + entry.y + '}' +
      '. ' +
      'MVT will be fetched again... '
    console.warn(message, error)
    chrome.devtools.inspectedWindow.eval("console.warn('" + message + "')")

    //retry...
    try {
      blob = await fetchTile(entry)
    } catch (error) {
      errors.push(error);
    }
  }

  if (!blob) {
    throw Error('Loading failed for tile {z: ' + entry.z + ', x: ' + entry.x + ', y: ' + entry.y + '}', { cause: errors });
  }

  return blob;
};

const getVectorTileForBlob = async (blob: Blob): Promise<VectorTile> => new VectorTile(new Pbf(await blob.arrayBuffer()));

const prepareGeoJsonTile = async (
  entry: TableEntry
): Promise<Record<string, GeoJSON> | { error: string }> => {
  try {
    const vectorTile = await getVectorTileForBlob(await getBlobForTableEntryWithFallback(entry));
    return tileToGeoJson(vectorTile, entry.z, entry.x, entry.y)
  } catch (error) {
    const message = '... Loading failed for tile {z: ' + entry.z + ', x: ' + entry.x + ', y: ' + entry.y + '}'
    console.error(message, error);
    chrome.devtools.inspectedWindow.eval("console.error('" + message + "')")
    return { error: message }
  }
}

const createViewContent = (
  entry: TableEntry,
  geoJsonOrJsonError: Record<string, GeoJSON> | { error: string },
): object => {

  return {
    ...entry,
    extra: undefined,
    tile: geoJsonOrJsonError
  }
}

const toMvtLink = (entry: TableEntry): HTMLAnchorElement => {
  const requestUrl = entry.url
  const a = document.createElement('a')
  a.setAttribute('href', requestUrl)
  a.addEventListener('click', async (e) => {
    e.preventDefault()
    e.stopPropagation()

    const fileName = entry.z + '_' + entry.x + '_' + entry.y + '.mvt'

    try {
      const blob = await getBlobForTableEntryWithFallback(entry);
      saveFromBinaryData(await blob.arrayBuffer(), fileName);
    } catch (error) {
      const message =
        'Loading failed for tile ' +
        '{z: ' +
        entry.z +
        ', x: ' +
        entry.x +
        ', y: ' +
        entry.y +
        '}'
      console.error(message, error)
      chrome.devtools.inspectedWindow.eval("console.error('" + message + "')")
    }
    return false
  })
  const url = new URL(requestUrl)
  a.textContent = url.pathname + url.search + url.hash
  return a
}

const fetchTile = async (entry: TableEntry): Promise<Blob> => {
  const headers = { ...entry.headers }
  if (headers.accept) {
    headers.accept = '*/*'
  } else {
    headers.Accept = '*/*'
  }
  const res = await window.fetch(entry.url, { method: 'GET', headers: headers })
  const blob = new Blob([await res.arrayBuffer()], { type: "application/vnd.mapbox-vector-tile" })
  await tileStore.set(await hashTableEntry(entry), blob);
  return blob
}

const saveFromBinaryData = (
  arrayBuffer: ArrayBuffer,
  fileName: string,
) => {
  const newBlob = new Blob([arrayBuffer], { type: "application/vnd.mapbox-vector-tile" })
  const data = window.URL.createObjectURL(newBlob)
  const link = document.createElement('a')
  link.href = data
  link.download = fileName
  link.click()
  window.URL.revokeObjectURL(data)
}

const toRow = async (div: HTMLDivElementWithEntry, entry: TableEntry): Promise<HTMLDivElementWithEntry> => {
  div.setAttribute('entry-hash', await hashTableEntry(entry))
  div.entry = entry
  div.setAttribute('role', 'row')
  return div
}

const toCell = (div: HTMLDivElement): HTMLDivElement => {
  div.setAttribute('role', 'cell')
  return div
}

const findElementForEntry = async (entry: TableEntry): Promise<HTMLDivElementWithEntry | null> => {
  const entryHash = await hashTableEntry(entry)
  const rowsNodeList = tilesTable.querySelectorAll('[role=row]')
  for (let i = 0; i < rowsNodeList.length; i++) {
    const rowElement = rowsNodeList.item(i)
    if (
      rowElement.hasAttribute('entry-hash') &&
      rowElement.getAttribute('entry-hash') === entryHash
    ) {
      return rowElement as HTMLDivElementWithEntry
    }
  }
  return null
}

const formatNumberLength = (num: number, length: number): string => {
  let r = '' + num
  while (r.length < length) {
    r = '0' + r
  }
  return r
}

const formatTime = (dateString: string): string => {
  if (!dateString) {
    return ''
  }

  const date = new Date(dateString)
  return (
    formatNumberLength(date.getUTCHours(), 2) +
    ':' +
    formatNumberLength(date.getUTCMinutes(), 2) +
    ':' +
    formatNumberLength(date.getUTCSeconds(), 2) +
    '.' +
    formatNumberLength(date.getUTCMilliseconds(), 3)
  )
}

const isNeedToScroll = (scrollableElement: HTMLElement): boolean => {
  return (
    Math.abs(
      scrollableElement.offsetHeight + scrollableElement.scrollTop - scrollableElement.scrollHeight,
    ) < 5
  )
}

const processPendingEntry = async (entry: TableEntry) => {
  let rowNode: HTMLDivElementWithEntry,
    statusNode: HTMLDivElement,
    urlNode: HTMLDivElement,
    xNode: HTMLDivElement,
    yNode: HTMLDivElement,
    zNode: HTMLDivElement,
    featuresCountNode: HTMLDivElement,
    startDateNode: HTMLDivElement,
    durationNode: HTMLDivElement,
    nEndedNode: HTMLDivElement

  tilesTable.appendChild(
    (rowNode = await toRow(document.createElement('div') as HTMLDivElementWithEntry, entry)),
  )
  rowNode.appendChild((statusNode = toCell(document.createElement('div'))))
  rowNode.appendChild((zNode = toCell(document.createElement('div'))))
  rowNode.appendChild((xNode = toCell(document.createElement('div'))))
  rowNode.appendChild((yNode = toCell(document.createElement('div'))))
  rowNode.appendChild(toCell(document.createElement('div'))) // Will always be an empty cell for a pending entry
  rowNode.appendChild((urlNode = toCell(document.createElement('div'))))
  rowNode.appendChild(toCell(document.createElement('div'))) // Will always be an empty cell for a pending entry
  rowNode.appendChild((featuresCountNode = toCell(document.createElement('div'))))
  rowNode.appendChild((startDateNode = toCell(document.createElement('div'))))
  rowNode.appendChild((nEndedNode = toCell(document.createElement('div'))))
  rowNode.appendChild((durationNode = toCell(document.createElement('div'))))

  statusNode.textContent = entry.status?.toString()
  urlNode.appendChild(toMvtLink(entry))
  zNode.textContent = String(entry.z)
  xNode.textContent = String(entry.x)
  yNode.textContent = String(entry.y)
  startDateNode.textContent = String(entry.startOrder) + ' | ' + formatTime(entry.startedDateTime)
  durationNode.textContent = String(entry.time ? prettyMilliseconds(Math.round(entry.time)) : '')
  nEndedNode.textContent = String(entry.endOrder || '')

  featuresCountNode.classList.add('wrap-content')
  rowNode.classList.add('pending-tile')
}

const processFinishedEntry = async (entry: TableEntry) => {
  const rowNode = await findElementForEntry(entry)
  if (!rowNode) return

  const statusNode = rowNode.children[0]
  const bytesNode = rowNode.children[4]
  const layersCountNode = rowNode.children[6]
  const featuresCountNode = rowNode.children[7]
  const nEndedNode = rowNode.children[9]

  if (statusNode) statusNode.textContent = entry.status?.toString()
  if (bytesNode) bytesNode.textContent = String(entry.tileSize ? prettyBytes(entry.tileSize) : '')
  if (nEndedNode) nEndedNode.textContent = String(entry.endOrder || '')

  rowNode.classList.remove('pending-tile')

  if (entry.extra.isValid) {
    rowNode.entry = entry

    const statistics = entry.statistics
    if (statistics) {
      if (entry.extra.isEmpty || !statistics.featuresCount) {
        rowNode.classList.add('empty-tile')
      }

      if (layersCountNode) layersCountNode.textContent = statistics.layersCount ? String(statistics.layersCount) : ''

      const layersStatistics = statistics.byLayers
      if (featuresCountNode) featuresCountNode.textContent = Object.keys(layersStatistics)
        .map((layerName) => layerName + ': ' + layersStatistics[layerName]?.featuresCount)
        .join('\n')
    }
  } else {
    rowNode.classList.add('no-success-tile')
  }
}

const processRemovedEntry = async (entry: TableEntry) => {
  const rowNode = await findElementForEntry(entry)
  if (!rowNode) {
    return
  }
  rowNode.remove()
}

const doAutoScrollableOperation = async (operation: () => Promise<void>) => {
  const needToScroll = isNeedToScroll(tilesTable)
  await operation()
  if (needToScroll && tilesTable.lastChild) {
    const lastRow = tilesTable.lastChild
    if (
      lastRow &&
      lastRow.firstChild &&
      'scrollIntoView' in lastRow.firstChild &&
      lastRow.firstChild.scrollIntoView &&
      typeof lastRow.firstChild.scrollIntoView === 'function'
    ) {
      lastRow.firstChild.scrollIntoView()
    }
  }
}
