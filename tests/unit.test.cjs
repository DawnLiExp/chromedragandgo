const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const script = name => fs.readFileSync(path.join(root, name), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));

class Element {
  constructor(tag = 'div', attributes = {}) {
    this.tag = tag;
    Object.assign(this, { baseURI: 'https://example.test/page', ...attributes });
  }
  getAttribute(name) { return this[name]; }
  matches(selector) {
    return selector.split(', ').some(item => {
      if (item === '[role="textbox"]') return this.role === 'textbox';
      if (item.endsWith('[href]')) return this.tag === item.slice(0, -6) && this.href !== undefined;
      return this.tag === item;
    });
  }
}

function content({ selection, send } = {}) {
  const listeners = new Map();
  const messages = [];
  const warnings = [];
  vm.runInNewContext(script('dragandgo.js'), {
    Element, URL, console: { warn: message => warnings.push(message) },
    document: { addEventListener: (type, handler) => listeners.set(type, handler) },
    window: { getSelection: () => selection || { isCollapsed: true } },
    chrome: { runtime: { sendMessage: async message => {
      messages.push(plain(message));
      return send ? send(message) : { ok: true };
    } } }
  });
  async function fire(type, overrides = {}) {
    const event = {
      isTrusted: true, clientX: 100, clientY: 100, prevented: false,
      path: [new Element()], dataTransfer: {},
      composedPath() { return this.path; },
      preventDefault() { this.prevented = true; },
      ...overrides
    };
    await listeners.get(type)(event);
    return event;
  }
  return { fire, messages, warnings, listeners };
}

const link = () => new Element('a', { href: '/destination' });
const start = (app, source = link(), rest = {}) => app.fire('dragstart', { path: [source], ...rest });

for (const [name, dx, dy, side, active] of [
  ['upper left', -30, -30, 'before', true],
  ['lower left', -30, 30, 'before', false],
  ['upper right', 30, -30, 'after', true],
  ['lower right', 30, 30, 'after', false],
  ['horizontal', -30, 0, 'before', false],
  ['vertical', 0, -30, 'after', true]
]) {
  test(`drag direction: ${name}`, async () => {
    const app = content();
    await start(app);
    await app.fire('drop', { clientX: 100 + dx, clientY: 100 + dy });
    assert.deepEqual(app.messages, [{ type: 'open-tab', url: 'https://example.test/destination', side, active }]);
  });
}

for (const [dx, dy, count] of [[0, 0, 0], [15, 0, 0], [10, 10, 0], [16, 0, 1], [12, 12, 1]]) {
  test(`distance threshold: ${dx},${dy}`, async () => {
    const app = content();
    await start(app);
    const drop = await app.fire('drop', { clientX: 100 + dx, clientY: 100 + dy });
    assert.equal(app.messages.length, count);
    assert.equal(drop.prevented, true, 'handled short drops must not navigate the source page');
  });
}

test('linked image opens its enclosing link, including nested elements', async () => {
  const app = content();
  await app.fire('dragstart', { path: [new Element('img', { src: 'https://images.test/image.png' }), new Element('span'), link()] });
  await app.fire('drop', { clientX: 140 });
  assert.equal(app.messages[0].url, 'https://example.test/destination');
});

for (const [name, attributes, expected] of [
  ['responsive image', { currentSrc: 'https://images.test/current.png', src: 'https://images.test/fallback.png' }, 'https://images.test/current.png'],
  ['fallback image', { currentSrc: '', src: 'https://images.test/fallback.png' }, 'https://images.test/fallback.png'],
  ['relative link', { href: '../target' }, 'https://example.test/target']
]) {
  test(name, async () => {
    const app = content();
    await start(app, new Element(name.includes('image') ? 'img' : 'a', attributes));
    await app.fire('drop', { clientX: 140 });
    assert.equal(app.messages[0].url, expected);
  });
}

for (const href of ['javascript:alert(1)', 'data:image/png;base64,AA==', 'blob:https://example.test/id', 'chrome://settings', 'ftp://example.test/file', 'http://[invalid']) {
  test(`unsupported source: ${href.split(':')[0]}`, async () => {
    const app = content();
    await start(app, new Element('a', { href }));
    assert.equal((await app.fire('dragover')).prevented, false);
    assert.equal((await app.fire('drop', { clientX: 140 })).prevented, false);
    assert.equal(app.messages.length, 0);
  });
}

test('selected text inside a link is not treated as link dragging', async () => {
  const app = content({ selection: { isCollapsed: false, containsNode: () => true } });
  await start(app);
  await app.fire('drop', { clientX: 140 });
  assert.equal(app.messages.length, 0);
});

test('unrelated text selection does not disable an image drag', async () => {
  const app = content({ selection: { isCollapsed: false, containsNode: () => false } });
  await start(app, new Element('img', { src: '/image.png' }));
  await app.fire('drop', { clientX: 140 });
  assert.equal(app.messages.length, 1);
});

for (const target of [new Element('input'), new Element('textarea'), new Element('select'), new Element('div', { isContentEditable: true }), new Element('div', { role: 'textbox' })]) {
  test(`editable target retains native behavior: ${target.tag}/${target.role || target.isContentEditable || ''}`, async () => {
    const app = content();
    await start(app);
    assert.equal((await app.fire('dragover', { path: [target] })).prevented, false);
    assert.equal((await app.fire('drop', { path: [target], clientX: 140 })).prevented, false);
    assert.equal(app.messages.length, 0);
  });
}

test('drag originating inside an editor retains native behavior', async () => {
  const app = content();
  await app.fire('dragstart', { path: [link(), new Element('div', { isContentEditable: true })] });
  await app.fire('drop', { clientX: 140 });
  assert.equal(app.messages.length, 0);
});

test('ordinary text, external drags, and untrusted events do not open tabs', async () => {
  const app = content();
  await app.fire('drop', { clientX: 140 });
  await start(app, new Element('p'));
  await app.fire('drop', { clientX: 140 });
  await start(app, link(), { isTrusted: false });
  await app.fire('drop', { clientX: 140 });
  assert.equal(app.messages.length, 0);
});

test('cancel, duplicate drop, and subsequent drags clear state correctly', async () => {
  const app = content();
  await start(app);
  await app.fire('dragend');
  await app.fire('drop', { clientX: 140 });
  assert.equal(app.messages.length, 0);
  for (let i = 0; i < 2; i++) {
    await start(app);
    await app.fire('drop', { clientX: 140 });
    await app.fire('drop', { clientX: 140 });
  }
  assert.equal(app.messages.length, 2);
  await start(app);
  await start(app, new Element('p'));
  await app.fire('drop', { clientX: 140 });
  assert.equal(app.messages.length, 2);
});

test('modifier keys and legacy options do not disable dragging', async () => {
  const app = content();
  await start(app, link(), { altKey: true, ctrlKey: true, metaKey: true, shiftKey: true });
  await app.fire('drop', { clientX: 140 });
  assert.equal(app.messages.length, 1);
  assert.deepEqual([...app.listeners.keys()], ['dragstart', 'dragover', 'drop', 'dragend']);
});

for (const send of [() => ({ ok: false }), () => { throw new Error('private URL'); }]) {
  test('communication errors are handled without exposing page data', async () => {
    const app = content({ send });
    await start(app);
    await app.fire('drop', { clientX: 140 });
    assert.equal(app.warnings.length, 1);
    assert.doesNotMatch(app.warnings[0], /example\.test|private URL/);
  });
}

function background({ tab = { id: 7, index: 4, windowId: 2 }, getError, createError } = {}) {
  let listener;
  const created = [];
  const gets = [];
  vm.runInNewContext(script('background.js'), {
    URL, chrome: {
      runtime: { id: 'test-extension', onMessage: { addListener: handler => { listener = handler; } } },
      tabs: {
        get: async id => { gets.push(id); if (getError) throw new Error('closed'); return tab; },
        create: async properties => { if (createError) throw new Error('failed'); created.push(plain(properties)); }
      }
    }
  });
  const invoke = (message, sender = { id: 'test-extension', tab: { id: 7, index: 0, windowId: 99 } }) => new Promise(resolve => {
    let responded = false;
    const keepAlive = listener(message, sender, result => { responded = true; resolve(plain(result)); });
    if (!keepAlive && !responded) resolve(undefined);
  });
  return { invoke, created, gets };
}

const request = overrides => ({ type: 'open-tab', url: 'https://example.test/target', side: 'before', active: true, ...overrides });

for (const side of ['before', 'after']) {
  test(`background uses current source position and window: ${side}`, async () => {
    const app = background();
    assert.deepEqual(await app.invoke(request({ side })), { ok: true });
    assert.deepEqual(app.created, [{ url: 'https://example.test/target', windowId: 2, index: side === 'before' ? 4 : 5, active: true }]);
    assert.deepEqual(app.gets, [7]);
  });
}

test('each request refreshes source position during consecutive drags', async () => {
  const tab = { id: 7, index: 0, windowId: 2 };
  const app = background({ tab });
  await app.invoke(request({ active: false }));
  tab.index = 6;
  tab.windowId = 3;
  await app.invoke(request());
  assert.deepEqual(app.created.map(item => [item.index, item.windowId, item.active]), [[0, 2, false], [6, 3, true]]);
});

test('background rejects malformed messages, invalid URLs, and unrelated senders', async () => {
  const app = background();
  for (const overrides of [
    { url: null }, { url: {} }, { url: '/relative' }, { url: 'javascript:alert(1)' },
    { url: 'data:text/html,test' }, { url: 'blob:https://example.test/id' },
    { url: 'chrome://settings' }, { side: 'middle' }, { active: 'true' }
  ]) assert.deepEqual(await app.invoke(request(overrides)), { ok: false });
  for (const sender of [{}, { id: 'other', tab: { id: 7 } }, { id: 'test-extension' }, { id: 'test-extension', tab: { id: '7' } }]) {
    assert.deepEqual(await app.invoke(request(), sender), { ok: false });
  }
  assert.equal(await app.invoke({ type: 'closeMe' }), undefined);
  assert.equal(await app.invoke(null), undefined);
  assert.equal(app.created.length, 0);
  assert.equal(app.gets.length, 0);
});

for (const url of ['http://example.test/', 'https://example.test/', 'file:///test/image.png']) {
  test(`supported URL: ${url.split(':')[0]}`, async () => {
    const app = background();
    assert.deepEqual(await app.invoke(request({ url })), { ok: true });
  });
}

for (const options of [{ getError: true }, { createError: true }]) {
  test(`background reports a failed tab operation: ${Object.keys(options)[0]}`, async () => {
    assert.deepEqual(await background(options).invoke(request()), { ok: false });
  });
}

test('manifest and bilingual resources are complete and use no settings or API permissions', () => {
  const manifest = JSON.parse(script('manifest.json'));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, '2.1.0');
  assert.equal(manifest.default_locale, 'en');
  for (const key of ['permissions', 'host_permissions', 'options_page', 'options_ui']) assert.equal(manifest[key], undefined);
  assert.equal(manifest.content_scripts[0].all_frames, true);
  for (const name of [manifest.background.service_worker, ...manifest.content_scripts.flatMap(item => item.js), ...Object.values(manifest.icons)]) {
    assert.equal(fs.existsSync(path.join(root, name)), true, name);
  }
  const locales = fs.readdirSync(path.join(root, '_locales')).filter(name => !name.startsWith('.'));
  assert.deepEqual(locales.sort(), ['en', 'zh_CN']);
  for (const locale of locales) {
    const messages = JSON.parse(script(`_locales/${locale}/messages.json`));
    assert.deepEqual(Object.keys(messages).sort(), ['extDescription', 'extName']);
    for (const key of ['name', 'description']) assert.ok(messages[manifest[key].slice(6, -2)].message);
  }
  for (const name of ['background.js', 'dragandgo.js']) {
    assert.doesNotMatch(script(name), /chrome\.storage|runtime\.connect|canvas|alt_key|ctrl_key|search_engine/);
  }
});
