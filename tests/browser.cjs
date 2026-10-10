// Optional end-to-end checks. Runtime code has no Playwright dependency.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(__dirname, '..');
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
let framePort;

function fixture(request, response) {
  const base = `http://127.0.0.1:${request.socket.localPort}`;
  const url = new URL(request.url, base);
  if (url.pathname === '/image.png') {
    response.writeHead(200, { 'Content-Type': 'image/png' });
    response.end(image);
    return;
  }
  const kind = url.searchParams.get('kind') || 'link';
  const picture = '<img id="source" src="/image.png?resource=fallback" srcset="/image.png?resource=current 1x" alt="Test image">';
  const sources = {
    link: '<a id="source" href="/opened?kind=link"><span>Drag this link</span></a>',
    image: picture,
    'linked-image': `<a href="/opened?kind=outer">${picture}</a>`,
    invalid: '<a id="source" href="javascript:void(0)">Unsupported link</a>',
    text: '<p id="source">Select this text</p>',
    'editable-source': '<div contenteditable="true"><a id="source" href="/opened?kind=editor">Editor link</a></div>',
    iframe: `<iframe src="http://127.0.0.1:${framePort}/fixture?kind=link"></iframe>`
  };
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(`<!doctype html><meta charset="utf-8"><title>Drag fixture</title>
    <style>
      body { margin: 0; min-height: 850px; font: 16px sans-serif; }
      #source { position: absolute; left: 440px; top: 330px; width: 140px; height: 80px; display: block; }
      a#source { background: #ddd; } img { image-rendering: pixelated; }
      #editor { position: absolute; left: 730px; top: 570px; width: 200px; height: 80px; }
      iframe { position: absolute; left: 50px; top: 30px; width: 1100px; height: 780px; border: 0; }
    </style>${url.pathname === '/opened' ? '<p>Opened destination</p>' : sources[kind]}
    <input id="editor" aria-label="Native drop target"><script>
      window.dragEvents = [];
      for (const type of ['dragstart', 'drop', 'dragend']) {
        document.addEventListener(type, event => {
          window.dragEvents.push({ type, trusted: event.isTrusted, x: event.clientX, y: event.clientY, prevented: event.defaultPrevented });
        }, true);
      }
    </script>`);
}

async function server() {
  const instance = http.createServer(fixture);
  await new Promise(resolve => instance.listen(0, '127.0.0.1', resolve));
  return instance;
}

(async () => {
  assert.ok(process.env.CHROME_PATH, 'Set CHROME_PATH to a Chrome for Testing executable.');
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'dragandgo-test-'));
  const extension = path.join(temp, 'extension');
  const profile = path.join(temp, 'profile');
  const servers = [];
  let context;
  let passed = 0;
  const errors = [];
  const launch = () => chromium.launchPersistentContext(profile, {
    executablePath: process.env.CHROME_PATH,
    headless: true,
    viewport: { width: 1250, height: 850 },
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  const getWorker = () => context.serviceWorkers().find(item => item.url().endsWith('/background.js')) ||
    context.waitForEvent('serviceworker', { timeout: 10000 });
  const log = name => { passed++; console.log(`PASS ${name}`); };

  try {
    await fs.mkdir(extension);
    // Seed legacy option keys, then remove storage permission at the same ID.
    await fs.writeFile(path.join(extension, 'manifest.json'), JSON.stringify({
      manifest_version: 3, name: 'Legacy test fixture', version: '2.0.6',
      permissions: ['storage', 'tabs'], host_permissions: ['<all_urls>'],
      content_scripts: [{ matches: ['<all_urls>'], js: ['dragandgo.js'], all_frames: true }],
      background: { service_worker: 'background.js' }
    }));
    await fs.copyFile(path.join(root, 'background.js'), path.join(extension, 'background.js'));
    await fs.copyFile(path.join(root, 'dragandgo.js'), path.join(extension, 'dragandgo.js'));
    context = await launch();
    const legacyWorker = await getWorker();
    const extensionId = new URL(legacyWorker.url()).host;
    await legacyWorker.evaluate(async () => {
      const settings = { alt_key: true, ctrl_key: true, gesture: 63, restricted_distance: 9999, search_engine: 'https://unused.test/?q=' };
      await chrome.storage.sync.set(settings);
      await chrome.storage.local.set(settings);
    });
    await context.close();
    context = null;
    const manifest = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'));
    for (const name of ['manifest.json', manifest.background.service_worker, ...manifest.content_scripts.flatMap(item => item.js), ...Object.values(manifest.icons)]) {
      await fs.copyFile(path.join(root, name), path.join(extension, name));
    }
    await fs.cp(path.join(root, '_locales'), path.join(extension, '_locales'), { recursive: true });
    context = await launch();
    context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
    let worker = await getWorker();
    assert.equal(new URL(worker.url()).host, extensionId);
    assert.equal(await worker.evaluate(() => chrome.runtime.getManifest().version), '2.1.0');
    assert.equal(await worker.evaluate(() => chrome.runtime.onMessage.hasListeners()), true);
    log('legacy settings remain unused after storage permission is removed');

    servers.push(await server(), await server());
    framePort = servers[1].address().port;
    const base = `http://127.0.0.1:${servers[0].address().port}`;
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'warning') console.log('Browser warning:', message.text()); });
    const tabs = () => worker.evaluate(() => chrome.tabs.query({}));

    async function prepare(kind = 'link', targetPage = page) {
      await targetPage.goto(`${base}/fixture?kind=${kind}`);
      await targetPage.bringToFront();
      if (kind === 'image' || kind === 'linked-image') {
        await targetPage.locator('#source').evaluate(image => image.decode());
      }
      return kind === 'iframe' ? targetPage.frameLocator('iframe').locator('#source') : targetPage.locator('#source');
    }

    async function drag(locator, dx, dy, { targetPage = page, destination, cancel = false, modifiers = [], beforeDrop } = {}) {
      const box = await locator.boundingBox();
      assert.ok(box);
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      for (const key of modifiers) await targetPage.keyboard.down(key);
      await targetPage.mouse.move(x, y);
      await targetPage.mouse.down();
      // Trigger native HTML dragging with real mouse input before travelling.
      await targetPage.mouse.move(x + 6, y, { steps: 3 });
      await targetPage.mouse.move(destination?.x ?? x + dx, destination?.y ?? y + dy, { steps: 20 });
      if (cancel) await targetPage.keyboard.press('Escape');
      if (beforeDrop) await beforeDrop();
      await targetPage.mouse.up();
      for (const key of modifiers.reverse()) await targetPage.keyboard.up(key);
    }

    async function opens(name, { kind = 'link', dx = -160, dy = -120, targetPage = page, modifiers, stopWorker = false } = {}) {
      const locator = await prepare(kind, targetPage);
      const before = await tabs();
      // The dragged page is frontmost; query its active tab explicitly.
      const [sourceTab] = await worker.evaluate(() => chrome.tabs.query({ active: true, lastFocusedWindow: true }));
      assert.ok(sourceTab);
      if (stopWorker) {
        const cdp = await context.browser().newBrowserCDPSession();
        const { targetInfos } = await cdp.send('Target.getTargets');
        const target = targetInfos.find(item => item.type === 'service_worker' && item.url === worker.url());
        assert.ok(target);
        await cdp.send('Target.closeTarget', { targetId: target.targetId });
        await cdp.detach();
      }
      const openedPromise = context.waitForEvent('page', { timeout: 10000 });
      await drag(locator, dx, dy, { targetPage, modifiers });
      const opened = await openedPromise.catch(async error => {
        console.log('Drag diagnostics:', await locator.evaluate(() => window.dragEvents));
        const management = await context.newPage();
        await management.goto('chrome://extensions');
        console.log('Extension diagnostics:', await management.evaluate(id => new Promise(resolve => {
          chrome.developerPrivate.getExtensionInfo(id, info => resolve({ state: info.state, runtime: info.runtimeErrors, manifest: info.manifestErrors, disableReasons: info.disableReasons }));
        }), extensionId));
        throw error;
      });
      await opened.waitForLoadState('domcontentloaded');
      worker = await getWorker();
      const after = await tabs();
      const created = after.filter(tab => !before.some(previous => previous.id === tab.id));
      assert.equal(created.length, 1, `${name}: exactly one new tab`);
      const current = after.find(tab => tab.id === sourceTab.id);
      assert.equal(created[0].windowId, sourceTab.windowId);
      assert.equal(created[0].index, current.index + (dx < 0 ? -1 : 1));
      assert.equal(created[0].active, dy < 0);
      assert.equal(current.active, dy >= 0);
      const events = await locator.evaluate(() => window.dragEvents);
      assert.ok(events.some(event => event.type === 'dragstart' && event.trusted));
      assert.ok(events.some(event => event.type === 'drop' && event.trusted));
      const expected = kind === 'image' ? '/image.png?resource=current' : kind === 'linked-image' ? '/opened?kind=outer' : '/opened?kind=link';
      assert.equal(new URL(opened.url()).pathname + new URL(opened.url()).search, expected);
      await opened.close();
      log(name);
    }

    for (const [name, dx, dy] of [['upper left', -160, -120], ['lower left', -160, 120], ['upper right', 160, -120], ['lower right', 160, 120]]) {
      await opens(`link ${name}`, { dx, dy });
      await opens(`image ${name}`, { kind: 'image', dx, dy });
    }
    await opens('linked image opens outer link', { kind: 'linked-image' });
    await opens('matching cross-origin iframe', { kind: 'iframe' });
    // macOS treats Control + mouse as a right click before HTML dragging starts.
    await opens('Shift and legacy settings do not suppress drag', { modifiers: ['Shift'] });
    await opens('Alt image drag is not disabled', { kind: 'image', modifiers: ['Alt'] });
    await opens('horizontal drag opens in background', { dx: -160, dy: 0 });
    await opens('vertical drag opens to the right', { dx: 0, dy: -120 });
    await opens('service worker restarts after termination', { stopWorker: true });

    for (const [name, kind, options] of [
      ['short distance', 'link', { dx: 10, dy: 0 }],
      ['cancelled drag', 'link', { cancel: true }],
      ['unsupported URL', 'invalid', {}],
      ['editable source', 'editable-source', {}],
      ['editable drop target', 'link', { editor: true }],
      ['selected text inside link', 'link', { selection: true }]
    ]) {
      const locator = await prepare(kind);
      const before = await tabs();
      if (options.selection) {
        await locator.evaluate(element => {
          const range = document.createRange();
          range.selectNodeContents(element);
          window.getSelection().removeAllRanges();
          window.getSelection().addRange(range);
        });
      }
      let destination;
      if (options.editor) {
        const box = await page.locator('#editor').boundingBox();
        destination = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      }
      const dragSource = options.selection ? locator.locator('span') : locator;
      await drag(dragSource, options.dx ?? -160, options.dy ?? 120, { ...options, destination });
      await page.waitForTimeout(200);
      assert.equal((await tabs()).length, before.length, name);
      assert.equal(page.url(), `${base}/fixture?kind=${kind}`, 'source must not navigate');
      if (options.editor) assert.ok(await page.locator('#editor').inputValue(), 'native input drop should insert the link');
      log(name);
    }

    // Keep both windows open, and leave one background tab from each drag.
    await prepare();
    const windowPagePromise = context.waitForEvent('page');
    const secondWindow = await worker.evaluate(async url => (await chrome.windows.create({ url })).id, `${base}/fixture?kind=link`);
    const windowPage = await windowPagePromise;
    await windowPage.waitForLoadState('domcontentloaded');
    await opens('new tab stays in source window with multiple windows open', { targetPage: windowPage, dx: 160, dy: 120 });
    await worker.evaluate(id => chrome.windows.remove(id), secondWindow);
    const locator = await prepare();
    const [sourceTab] = await worker.evaluate(() => chrome.tabs.query({ active: true, lastFocusedWindow: true }));
    await worker.evaluate(id => chrome.tabs.move(id, { index: 0 }), sourceTab.id);
    for (let i = 0; i < 3; i++) {
      const before = await tabs();
      const openedPromise = context.waitForEvent('page');
      await drag(locator, -160, 120);
      await openedPromise;
      const after = await tabs();
      const current = after.find(tab => tab.id === sourceTab.id);
      const created = after.find(tab => !before.some(previous => previous.id === tab.id));
      assert.equal(created.index, current.index - 1);
      assert.equal(created.windowId, current.windowId);
      assert.equal(current.active, true);
    }
    log('consecutive left-background drags after source tab moves');

    const management = await context.newPage();
    await management.goto('chrome://extensions');
    const extensionErrors = await management.evaluate(id => new Promise(resolve => {
      chrome.developerPrivate.getExtensionInfo(id, info => resolve({
        runtime: info.runtimeErrors || [], manifest: info.manifestErrors || []
      }));
    }), extensionId);
    assert.deepEqual(extensionErrors, { runtime: [], manifest: [] });
    assert.deepEqual(errors, []);
    log('no page, extension runtime, or manifest errors');
    console.log(`Browser checks passed: ${passed}`);
  } finally {
    if (context) await context.close();
    await Promise.all(servers.map(instance => new Promise(resolve => instance.close(resolve))));
    await fs.rm(temp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
