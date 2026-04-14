import { TileStore } from './tile-store'

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'devtools-mapbox-vector-tiles') return
  // Clear the tile store when the dev tool panel is closed
  port.onDisconnect.addListener(async () => {
    await navigator.locks.request(
      'mapbox-vector-tiles-clear',
      async () => await new TileStore().clear(),
    )
  })
})

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.local.set({
    mvtRequestPattern: '.*\\/(?<z>\\d+)\\/(?<x>\\d+)\\/(?<y>\\d+)\\.mvt[^\\/]*$',
    trackEmptyResponse: true,
    trackOnlySuccessfulResponse: false,
  })
})
