import { TileStore } from './tile-store'
import { PORT_PREFIX } from './utils'

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

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.local.set({
    mvtRequestPattern: '.*\\/(?<z>\\d+)\\/(?<x>\\d+)\\/(?<y>\\d+)\\.mvt[^\\/]*$',
    trackEmptyResponse: true,
    trackOnlySuccessfulResponse: false,
  })
})
