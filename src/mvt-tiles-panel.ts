import prettyMilliseconds from 'pretty-ms'
import prettyBytes from 'pretty-bytes'
import { HTMLDivElementWithEntry, TableEntry } from './types'
import {
  hashTableEntry,
  isTableEntry,
  MVT_MIME_TYPE,
  formatTileId,
  PORT_PREFIX,
  formatTime,
} from './utils'
import { createJSONEditor } from 'vanilla-jsoneditor/standalone.js'
import { EntriesManager } from './entries-manager'

// Deps
const tabId = chrome.devtools.inspectedWindow.tabId
chrome.runtime.connect({ name: `${PORT_PREFIX}${tabId}` })
const entriesManager = new EntriesManager(String(tabId),
  // onAdd
  (entry) => doAutoScrollableOperation(() => processPendingEntry(entry)),
  // onUpdate
  (entry) => doAutoScrollableOperation(() => processFinishedEntry(entry)),
  // onRemove
  (entry) => doAutoScrollableOperation(() => processRemovedEntry(entry)),
)

// Local state
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
  const rowNode = tilesTable.querySelector(
    `[entry-hash="${entryHash}"]`,
  ) as HTMLDivElementWithEntry | null
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
  await entriesManager.clear()
  tilesTable.querySelectorAll('[role=row]').forEach((row) => row.remove())
}

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
      const blob = await entriesManager.getBlobForEntry(entry)
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
    entriesManager.trackEmptyResponse = Boolean(r.trackEmptyResponse)
    entriesManager.trackOnlySuccessfulResponse = Boolean(r.trackOnlySuccessfulResponse)
    const mvtRequestPattern = r.mvtRequestPattern?.toString()
    if (mvtRequestPattern) {
      try {
        entriesManager.mvtRequestPatternRegExp = new RegExp(mvtRequestPattern, 'i')
      } catch (e) {
        console.log('Mvt Request Pattern is invalid', r.mvtRequestPattern)
      }
    }
    updateControls(
      Boolean(r.trackEmptyResponse),
      Boolean(r.trackOnlySuccessfulResponse),
      r.mvtRequestPattern as string,
    )

    await entriesManager.clear()
    chrome.devtools.network.onRequestFinished.addListener(entriesManager.handleNetworkRequest)
  },
)

// Handle external changes to global state
chrome.storage.local.onChanged.addListener((changes) => {
  if (changes['trackEmptyResponse']) {
    entriesManager.trackEmptyResponse = !!changes['trackEmptyResponse'].newValue
    trackEmptyResponseCheckBox.checked = Boolean(changes['trackEmptyResponse'].newValue)
  }
  if (changes['trackOnlySuccessfulResponse']) {
    entriesManager.trackOnlySuccessfulResponse = !!changes['trackOnlySuccessfulResponse'].newValue
    trackOnlySuccessfulResponseCheckBox.checked = Boolean(
      changes['trackOnlySuccessfulResponse'].newValue,
    )
  }
  if (changes['mvtRequestPattern']) {
    const mvtRequestPattern = changes['mvtRequestPattern'].newValue?.toString()
    if (mvtRequestPattern) {
      try {
        entriesManager.mvtRequestPatternRegExp = new RegExp(mvtRequestPattern, 'i')
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
      const geoJsonOrJsonError = await entriesManager.getGeoJsonForEntry(entry)
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
