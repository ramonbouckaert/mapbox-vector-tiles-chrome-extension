chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.set({
        mvtRequestPattern: ".*\\/(?<z>\\d+)\\/(?<x>\\d+)\\/(?<y>\\d+)\\.mvt[^\\/]*$",
        trackEmptyResponse: true,
        trackOnlySuccessfulResponse: false
    });

    chrome.declarativeContent.onPageChanged.removeRules(undefined, () => {
        chrome.declarativeContent.onPageChanged.addRules([
            {
                conditions: [
                    new chrome.declarativeContent.PageStateMatcher({
                        pageUrl: {}  // Matches all pages
                    })
                ],
                actions: [new chrome.declarativeContent.ShowAction()]
            }
        ]);
    });
});