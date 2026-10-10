// Copyright(c) 2011 Wenzhang Zhu.
// All rights reserved.

(() => {
  const MIN_DISTANCE = 16;
  let drag = null;

  const elements = event => event.composedPath().filter(node => node instanceof Element);
  const isEditable = path => path.some(node => node.isContentEditable ||
    node.matches('input, textarea, select, [role="textbox"]'));

  function getURL(path) {
    const link = path.find(node => node.matches('a[href], area[href]'));
    const image = path.find(node => node.matches('img'));
    const value = link ? link.getAttribute('href') : image?.currentSrc || image?.src;
    if (!value) return null;

    try {
      const url = new URL(value, (link || image).baseURI);
      return ['http:', 'https:', 'file:'].includes(url.protocol) ? url.href : null;
    } catch {
      return null;
    }
  }

  document.addEventListener('dragstart', event => {
    drag = null;
    if (!event.isTrusted) return;
    const path = elements(event);
    if (isEditable(path)) return;

    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && path[0] &&
        selection.containsNode(path[0], true)) return;

    const url = getURL(path);
    if (url) drag = { url, x: event.clientX, y: event.clientY };
  }, true);

  document.addEventListener('dragover', event => {
    if (!event.isTrusted || !drag || isEditable(elements(event))) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  }, true);

  document.addEventListener('drop', async event => {
    if (!event.isTrusted) return;
    const source = drag;
    drag = null;
    if (!source || isEditable(elements(event))) return;
    event.preventDefault();

    const dx = event.clientX - source.x;
    const dy = event.clientY - source.y;
    if (Math.hypot(dx, dy) < MIN_DISTANCE) return;

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'open-tab',
        url: source.url,
        side: dx < 0 ? 'before' : 'after',
        active: dy < 0
      });
      if (!response?.ok) throw new Error('Open failed');
    } catch {
      // Do not log URLs or other page data.
      console.warn('Super Drag and Go: unable to open a tab. Reload this page and try again.');
    }
  }, true);

  document.addEventListener('dragend', () => { drag = null; }, true);
})();
