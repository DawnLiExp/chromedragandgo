// Copyright (c) Wenzhang Zhu and contributors.

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'open-tab') return false;

  let url;
  try {
    url = new URL(message.url);
  } catch {
    sendResponse({ ok: false });
    return false;
  }

  if (sender.id !== chrome.runtime.id || !Number.isInteger(sender.tab?.id) ||
      typeof message.url !== 'string' ||
      !['http:', 'https:', 'file:'].includes(url.protocol) ||
      !['before', 'after'].includes(message.side) ||
      typeof message.active !== 'boolean') {
    sendResponse({ ok: false });
    return false;
  }

  // Read the current position: the tab may have moved since the drag started.
  chrome.tabs.get(sender.tab.id)
    .then(tab => chrome.tabs.create({
      url: url.href,
      windowId: tab.windowId,
      index: tab.index + (message.side === 'after' ? 1 : 0),
      active: message.active
    }))
    .then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));

  // Keep the response channel open on Chrome versions without async listeners.
  return true;
});
