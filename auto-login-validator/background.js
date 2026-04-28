// background.js - captures HTTP responses and redirects

let activeTabId = null;
let pendingResponses = new Map(); // requestId -> { statusCode, locationHeader, finalUrl }

// Listen for response headers
chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (activeTabId && details.tabId === activeTabId) {
      const locationHeader = details.responseHeaders?.find(h => h.name.toLowerCase() === 'location')?.value;
      pendingResponses.set(details.requestId, {
        statusCode: details.statusCode,
        location: locationHeader,
        url: details.url
      });
    }
    return { responseHeaders: details.responseHeaders };
  },
  { urls: ["<all_urls>"], types: ["main_frame", "xmlhttprequest"] },
  ["responseHeaders", "extraHeaders"]
);

// Clean up after request completes
chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (pendingResponses.has(details.requestId)) {
      const data = pendingResponses.get(details.requestId);
      // store for later retrieval by content script
      chrome.storage.local.set({ [`resp_${details.requestId}`]: data });
      setTimeout(() => chrome.storage.local.remove(`resp_${details.requestId}`), 10000);
      pendingResponses.delete(details.requestId);
    }
  },
  { urls: ["<all_urls>"] }
);

// When popup asks for latest response data for a tab
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "getLastResponse") {
    // retrieve most recent response info (simplified: just return pending)
    sendResponse({ responses: Array.from(pendingResponses.values()) });
  }
  return true;
});

// Keep track of active tab for filtering
chrome.tabs.onActivated.addListener((activeInfo) => {
  activeTabId = activeInfo.tabId;
});