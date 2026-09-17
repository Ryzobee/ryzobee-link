import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';

// Test the shipped static application, not Vite's source modules. The preview
// server must already be running; this script never opens a serial device.
const url = process.env.LINK_TEST_URL ?? 'http://127.0.0.1:4180/';
const output = path.resolve(process.env.LINK_TEST_OUTPUT ?? 'test-results/offline');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  const failedRequests = [];
  const consoleErrors = [];
  const offlineResponses = [];
  let offline = false;
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  context.on('requestfailed', request => failedRequests.push({ url: request.url(), error: request.failure()?.errorText, headers: request.headers() }));
  context.on('response', response => {
    if (offline) offlineResponses.push({ url: response.url(), status: response.status(), serviceWorker: response.fromServiceWorker() });
  });
  // Prevent Chrome's ordinary HTTP cache from disguising a missing SW asset.
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await page.goto(url);
  await expect(page.getByRole('button', { name: '运行', exact: true })).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
    }
  });
  const cache = await page.evaluate(async () => {
    const name = (await caches.keys()).find(key => key.startsWith('ryzobee-link-'));
    const entries = (await (await caches.open(name)).keys()).map(request => new URL(request.url).pathname);
    return { name, entries };
  });
  assert.ok(cache.entries.some(file => file.endsWith('/simulator/ryzobee.wasm')), 'Wasm was not precached');
  assert.ok(cache.entries.some(file => /editor\.worker.*\.js$/.test(file)), 'Monaco Worker was not precached');

  offline = true;
  await context.setOffline(true);
  await page.reload();
  try {
    await expect(page.getByRole('button', { name: '运行', exact: true })).toBeVisible();
  } catch (error) {
    console.error(JSON.stringify({ stage: 'offline-reload', errors, failedRequests, consoleErrors, offlineResponses, body: await page.locator('body').innerText() }, null, 2));
    await page.screenshot({ path: path.join(output, 'offline-reload-failed.png'), fullPage: true });
    throw error;
  }
  // Chromium can report navigator.onLine=true after a SW-served offline reload;
  // prove network isolation with a fresh URL that was never cached instead.
  const networkBlocked = await page.evaluate(async () => {
    try { await fetch(`./not-precached-${crypto.randomUUID()}`); return false; }
    catch { return true; }
  });
  assert.equal(networkBlocked, true, 'An uncached resource unexpectedly reached the network');
  assert.equal(await page.evaluate(() => !!navigator.serviceWorker.controller), true);

  // Exercise Monaco through its real keyboard surface, without importing its
  // source module or injecting editor state. Preserve the executable example.
  const editor = page.locator('.monaco-editor');
  await editor.click({ position: { x: 250, y: 55 } });
  await page.keyboard.press('End');
  const markers = Array.from({ length: 4 }, (_, index) => `OFFLINE_EDITOR_CHECK_${index}`);
  for (const marker of markers) {
    await page.keyboard.type(`\n-- ${marker}`);
    await expect(page.locator('.view-lines')).toContainText(marker);
  }
  await expect(page.locator('.editor-status')).toHaveAttribute('data-save-state', 'saved');
  // Read the public download too: visible tokens alone must not hide an older
  // React state being used for save/send while Monaco shows newer characters.
  const pendingDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  const download = await pendingDownload;
  const stream = await download.createReadStream();
  let exportedSource = '';
  for await (const chunk of stream) exportedSource += chunk.toString();
  for (const marker of markers) assert.ok(exportedSource.includes(marker), `Export lost typed text: ${marker}`);

  await page.getByRole('button', { name: '运行', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '运行中' })).toBeVisible({ timeout: 15000 });
  const screen = page.getByLabel('240×240 交互模拟屏幕');
  const pixels = () => screen.evaluate(element => {
    const rgba = element.getContext('2d').getImageData(0, 0, 240, 240).data;
    return Array.from(rgba).reduce((sum, value, index) => (sum + value * (index % 13 + 1)) >>> 0, 0);
  });
  await expect.poll(pixels).not.toBe(0);
  const before = await pixels();
  const box = await screen.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 180 / 240);
  await expect.poll(pixels).not.toBe(before);
  await expect(page.locator('.log-text').filter({ hasText: /count\s+1/ })).toBeVisible();

  const layouts = [];
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 1024, height: 768 }, { width: 1470, height: 884 }]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(250);
    const layout = await page.evaluate(() => {
      const selectors = ['.global-bar', '.simulator-panel', '.files-panel', '.editor-panel', '.logs-panel'];
      const boxes = selectors.map(selector => {
        const rect = document.querySelector(selector).getBoundingClientRect();
        return { selector, x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right };
      });
      const storage = document.querySelector('.storage').getBoundingClientRect();
      const files = document.querySelector('.files-panel').getBoundingClientRect();
      const canvas = document.querySelector('.device-shell canvas').getBoundingClientRect();
      return { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight, boxes,
        canvas: { width: canvas.width, height: canvas.height },
        storage: { top: storage.top, bottom: storage.bottom, left: storage.left, right: storage.right },
        files: { top: files.top, bottom: files.bottom, left: files.left, right: files.right } };
    });
    assert.ok(layout.scrollWidth <= viewport.width, `Horizontal page overflow at ${viewport.width}px`);
    assert.ok(layout.scrollHeight <= viewport.height + 1, `Desktop page requires scrolling at ${viewport.width}×${viewport.height}`);
    assert.ok(layout.storage.bottom <= viewport.height, 'Storage is outside the visible viewport');
    for (const box of layout.boxes) assert.ok(box.x >= 0 && box.right <= viewport.width + 1, `${box.selector} overflows the page`);
    assert.ok(Math.abs(layout.canvas.width - layout.canvas.height) < 1, `Simulator screen is not square at ${viewport.width}px`);
    assert.ok(layout.storage.top >= layout.files.top && layout.storage.bottom <= layout.files.bottom + 1
      && layout.storage.left >= layout.files.left && layout.storage.right <= layout.files.right + 1,
    `Storage escapes its file panel at ${viewport.width}×${viewport.height}`);
    const screenshot = path.join(output, `offline-${viewport.width}x${viewport.height}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    layouts.push({ ...layout, screenshot });
  }
  await page.getByRole('button', { name: '停止', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '未运行' })).toBeVisible();
  assert.deepEqual(errors, []);
  const result = { offline: true, uncachedNetworkRequestBlocked: networkBlocked, ordinaryHttpCacheDisabled: true, cache, editorEdited: true, realLuaInteraction: true, layouts, errors, offlineResponses };
  await writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ ...result, cache: { name: cache.name, assets: cache.entries.length }, offlineResponses: {
    count: offlineResponses.length,
    runtime: offlineResponses.filter(response => /simulator|worker/.test(response.url)),
  } }, null, 2));
} finally {
  await browser.close();
}
