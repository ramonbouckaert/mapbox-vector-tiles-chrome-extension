import { TileStore } from './tile-store'
import { MVT_CONTENT_TYPES, MVT_REQUEST_PATTERNS, PORT_PREFIX } from './utils'

const tileStore = new TileStore()
const activePorts = new Set<chrome.runtime.Port>()

chrome.runtime.onConnect.addListener((port) => {
  if (!port.name.startsWith(PORT_PREFIX)) return
  const tabId = port.name.slice(PORT_PREFIX.length)
  activePorts.add(port)
  port.onDisconnect.addListener(async () => {
    activePorts.delete(port)
    await navigator.locks.request(`mapbox-vector-tiles-clear-${tabId}`, async () => {
      await tileStore.clearForTab(tabId)
    })
    if (activePorts.size === 0) {
      // All DevTools windows closed - clear the entire store as a safety net.
      await navigator.locks.request('mapbox-vector-tiles-clear', async () => {
        await tileStore.clear()
      })
    }
  })
})

// Clear on browser startup rather than on every service worker wake-up, so tiles
// belonging to still-open DevTools panels are not wiped when the worker restarts.
chrome.runtime.onStartup.addListener(() => {
  tileStore.clear().catch(console.error)
})

chrome.runtime.onInstalled.addListener(async () => {
  tileStore.clear().catch(console.error)
  // Only fill in missing settings - onInstalled also fires on extension and
  // browser updates, which must not overwrite the user's saved values.
  const defaults = {
    mvtRequestPattern: MVT_REQUEST_PATTERNS[0],
    mvtContentType: MVT_CONTENT_TYPES[0],
    trackEmptyResponse: true,
    trackOnlySuccessfulResponse: false,
    matchByContentType: true,
  }
  const existing = await chrome.storage.local.get(Object.keys(defaults))
  await chrome.storage.local.set({ ...defaults, ...existing })
})
