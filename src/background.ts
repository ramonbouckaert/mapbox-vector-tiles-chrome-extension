chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.local.set({
    mvtRequestPattern: '.*\\/(?<z>\\d+)\\/(?<x>\\d+)\\/(?<y>\\d+)\\.mvt[^\\/]*$',
    trackEmptyResponse: true,
    trackOnlySuccessfulResponse: false,
  })
})
