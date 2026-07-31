import prettyMilliseconds from 'pretty-ms'
import prettyBytes from 'pretty-bytes'
import { HTMLDivElementWithEntry, TableEntry } from './types'
import {
  hashTableEntry,
  isMatchMode,
  isTableEntry,
  MVT_CONTENT_TYPES,
  MVT_REQUEST_PATTERNS,
  NEVER_MATCHES,
  formatCoord,
  formatTileId,
  PORT_PREFIX,
  formatTime,
  tileFileName,
} from './utils'
import type { MatchMode } from './utils'
import { EntriesManager } from './entries-manager'

// Deps
const tabId = chrome.devtools.inspectedWindow.tabId
const connectToServiceWorker = () => {
  // chrome.runtime.id is undefined once the extension is reloaded or updated;
  // this panel is then orphaned and retrying would throw once a second forever.
  if (!chrome.runtime?.id) return
  let port: chrome.runtime.Port
  try {
    port = chrome.runtime.connect({ name: `${PORT_PREFIX}${tabId}` })
  } catch {
    return
  }
  // The port drops whenever the service worker is stopped for idling - reconnect
  // so the worker keeps tracking this panel and cleans up when it really closes.
  port.onDisconnect.addListener(() => setTimeout(connectToServiceWorker, 1000))
}
connectToServiceWorker()
const entriesManager = new EntriesManager(
  String(tabId),
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
let scrollRafId: number | undefined
// Both match values are kept here so that switching modes back and forth in the
// single text box does not discard the one that is not currently shown.
let mvtRequestPattern: string = MVT_REQUEST_PATTERNS[0]
let mvtContentType: string = MVT_CONTENT_TYPES[0]

// DOM references
const tilesTable = document.getElementById('tilesTable') as HTMLDivElement
const viewTileContainer = document.getElementById('viewTileContainer') as HTMLDivElement
const dialog = document.getElementById('viewTileDialog')
const closeButton = document.getElementsByClassName('viewTileDialog_closeButton')[0]
const trackEmptyResponseCheckBox = document.getElementById('trackEmptyResponse') as HTMLInputElement
const trackOnlySuccessfulResponseCheckBox = document.getElementById(
  'trackOnlySuccessfulResponse',
) as HTMLInputElement
const matchModeSelect = document.getElementById('matchMode') as HTMLSelectElement
const matchValueCombo = document.getElementById('matchValueCombo') as HTMLSpanElement
const matchValueText = document.getElementById('matchValue') as HTMLInputElement
const matchValueOptions = document.getElementById('matchValueOptions') as HTMLUListElement

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
  zNode.textContent = formatCoord(entry.z)
  xNode.textContent = formatCoord(entry.x)
  yNode.textContent = formatCoord(entry.y)
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
  if (autoScroll && scrollRafId === undefined) {
    scrollRafId = requestAnimationFrame(() => {
      scrollRafId = undefined
      const maxScrollTop = tilesTable.scrollHeight - tilesTable.clientHeight
      if (tilesTable.scrollTop >= maxScrollTop) return
      isAutoScrolling = true
      tilesTable.scrollTo({ top: tilesTable.scrollHeight, behavior: 'smooth' })
    })
  }
}

const onClear = async () => {
  await entriesManager.clear()
  // The header is a row too, so it has to be spared here.
  tilesTable.querySelectorAll('[role=row]:not(#tilesTableHeaderRow)').forEach((row) => row.remove())
}

const toCell = (div: HTMLDivElement): HTMLDivElement => {
  div.setAttribute('role', 'cell')
  return div
}

const saveFromBinaryData = (arrayBuffer: ArrayBuffer, fileName: string) => {
  const blob = new Blob([arrayBuffer], { type: MVT_CONTENT_TYPES[0] })
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
      saveFromBinaryData(await blob.arrayBuffer(), tileFileName(entry))
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
const textWidthCanvas = document.createElement('canvas')
const getTextWidth = (text: string, fontSize: string, fontName: string, fontWeight: string) => {
  const context = textWidthCanvas.getContext('2d')
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

const currentMatchMode = (): MatchMode =>
  isMatchMode(matchModeSelect.value) ? matchModeSelect.value : 'automatic'

const isContentTypeMode = () => currentMatchMode() === 'contentType'

// Suggestions dropdown
let suggestions: readonly string[] = MVT_CONTENT_TYPES
let activeSuggestion = -1

const closeSuggestions = () => {
  matchValueOptions.classList.remove('open')
  matchValueText.setAttribute('aria-expanded', 'false')
  matchValueText.removeAttribute('aria-activedescendant')
  activeSuggestion = -1
}

const setActiveSuggestion = (index: number) => {
  activeSuggestion = index
  const items = [...matchValueOptions.children]
  items.forEach((item, i) => item.classList.toggle('active', i === index))
  const active = index >= 0 ? items[index] : undefined
  if (active) {
    active.scrollIntoView({ block: 'nearest' })
    matchValueText.setAttribute('aria-activedescendant', active.id)
  } else {
    matchValueText.removeAttribute('aria-activedescendant')
  }
}

const commitMatchValue = () => {
  if (isContentTypeMode()) applyContentType(matchValueText.value)
  else applyRequestPattern(matchValueText.value)
  adjustInputTextWidth(matchValueText)
  updateSettings()
}

// An empty filter lists every suggestion, so clicking the field always shows the
// full set even when it already holds one of them.
const openSuggestions = (filter: string) => {
  const needle = filter.trim().toLowerCase()
  const matches = suggestions.filter((s) => !needle || s.toLowerCase().includes(needle))
  matchValueOptions.replaceChildren(
    ...matches.map((value, index) => {
      const item = document.createElement('li')
      item.textContent = value
      item.id = `matchValueOption-${index}`
      item.setAttribute('role', 'option')
      // mousedown runs before the input's blur, so the choice is not lost.
      item.addEventListener('mousedown', (e) => {
        e.preventDefault()
        matchValueText.value = value
        commitMatchValue()
        closeSuggestions()
      })
      return item
    }),
  )
  activeSuggestion = -1
  if (!matches.length) {
    closeSuggestions()
    return
  }
  matchValueOptions.classList.add('open')
  matchValueText.setAttribute('aria-expanded', 'true')
}

const applyMatchMode = (mode: MatchMode) => {
  entriesManager.matchMode = mode
  matchModeSelect.value = mode
  // Every mode transition funnels through here, so the suggestions are swapped
  // and the value box shown or hidden in one place.
  suggestions = mode === 'urlPattern' ? MVT_REQUEST_PATTERNS : MVT_CONTENT_TYPES
  matchValueCombo.classList.toggle('combo-hidden', mode === 'automatic')
  closeSuggestions()
}

const applyRequestPattern = (pattern: string) => {
  mvtRequestPattern = pattern
  // An empty box captures nothing, matching how an empty content type behaves.
  if (!pattern) {
    entriesManager.mvtRequestPatternRegExp = NEVER_MATCHES
    return
  }
  try {
    entriesManager.mvtRequestPatternRegExp = new RegExp(pattern, 'i')
  } catch (e) {
    console.log('Mvt Request Pattern is invalid', pattern)
  }
}

const applyContentType = (contentType: string) => {
  mvtContentType = contentType
  entriesManager.mvtContentType = contentType
}

// The one text box edits whichever value the selected mode uses.
const showMatchValue = () => {
  // Automatic mode has nothing to configure and hides the box entirely.
  if (currentMatchMode() === 'automatic') return
  const contentTypeMode = isContentTypeMode()
  const value = contentTypeMode ? mvtContentType : mvtRequestPattern
  matchValueText.title = contentTypeMode
    ? 'Response content type to capture'
    : 'Regular expression matched against the request URL'
  // Only reassign when it really differs - assigning resets the caret, and this
  // also runs in response to our own storage writes while the user is typing.
  if (matchValueText.value !== value) matchValueText.value = value
  adjustInputTextWidth(matchValueText)
}

// Coalesced, because the match value saves on every keystroke and each write
// echoes back through storage.onChanged.
let saveSettingsTimer: ReturnType<typeof setTimeout> | undefined
const updateSettings = () => {
  if (saveSettingsTimer !== undefined) clearTimeout(saveSettingsTimer)
  saveSettingsTimer = setTimeout(() => {
    saveSettingsTimer = undefined
    chrome.storage.local.set({
      trackEmptyResponse: trackEmptyResponseCheckBox.checked,
      trackOnlySuccessfulResponse: trackOnlySuccessfulResponseCheckBox.checked,
      matchMode: currentMatchMode(),
      mvtRequestPattern,
      mvtContentType,
    })
  }, 200)
}

// Reads the saved mode, migrating from the older boolean setting. A stored
// `false` was a deliberate choice of URL patterns and is kept; `true` was only
// ever the old default, so those profiles move on to Automatic.
const storedMatchMode = (mode: unknown, legacyMatchByContentType: unknown): MatchMode => {
  if (isMatchMode(mode)) return mode
  if (legacyMatchByContentType === false) return 'urlPattern'
  return 'automatic'
}

// Setup
chrome.storage.local.get(
  [
    'trackEmptyResponse',
    'trackOnlySuccessfulResponse',
    'matchMode',
    'matchByContentType',
    'mvtRequestPattern',
    'mvtContentType',
  ],
  async (r) => {
    entriesManager.trackEmptyResponse = Boolean(r.trackEmptyResponse)
    entriesManager.trackOnlySuccessfulResponse = Boolean(r.trackOnlySuccessfulResponse)
    trackEmptyResponseCheckBox.checked = Boolean(r.trackEmptyResponse)
    trackOnlySuccessfulResponseCheckBox.checked = Boolean(r.trackOnlySuccessfulResponse)
    applyMatchMode(storedMatchMode(r.matchMode, r.matchByContentType))
    applyRequestPattern(r.mvtRequestPattern?.toString() || MVT_REQUEST_PATTERNS[0])
    applyContentType(r.mvtContentType?.toString() || MVT_CONTENT_TYPES[0])
    showMatchValue()

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
  const matchChanged =
    changes['matchMode'] || changes['mvtRequestPattern'] || changes['mvtContentType']
  if (changes['matchMode']) {
    applyMatchMode(storedMatchMode(changes['matchMode'].newValue, undefined))
  }
  if (changes['mvtRequestPattern']) {
    applyRequestPattern(changes['mvtRequestPattern'].newValue?.toString() ?? '')
  }
  if (changes['mvtContentType']) {
    applyContentType(changes['mvtContentType'].newValue?.toString() ?? '')
  }
  if (matchChanged) showMatchValue()
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
matchModeSelect.addEventListener('change', () => {
  applyMatchMode(currentMatchMode())
  showMatchValue()
  updateSettings()
})
matchValueText.addEventListener('input', () => {
  commitMatchValue()
  openSuggestions(matchValueText.value)
})
matchValueText.addEventListener('focus', () => openSuggestions(''))
// Also on click, so clicking an already-focused field reopens the list.
matchValueText.addEventListener('click', () => openSuggestions(''))
matchValueText.addEventListener('blur', closeSuggestions)
matchValueText.addEventListener('keydown', (e) => {
  const items = matchValueOptions.children
  const isOpen = matchValueOptions.classList.contains('open')
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (!isOpen) return openSuggestions('')
    setActiveSuggestion((activeSuggestion + 1) % items.length)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    if (!isOpen) return
    setActiveSuggestion((activeSuggestion <= 0 ? items.length : activeSuggestion) - 1)
  } else if (e.key === 'Enter') {
    const chosen = items[activeSuggestion]?.textContent
    if (isOpen && chosen) {
      e.preventDefault()
      matchValueText.value = chosen
      commitMatchValue()
    }
    closeSuggestions()
  } else if (e.key === 'Escape') {
    closeSuggestions()
  }
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
      setTimeout(async () => {
        const { createJSONEditor } = await import('vanilla-jsoneditor/standalone.js')
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
