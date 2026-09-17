import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { installSerial } from './fake-serial';

test.use({ channel: 'chrome', viewport: { width: 1440, height: 1000 } });

test('real Lua screen accepts a completed click but not cancelled pointer capture', async ({ page }) => {
  await installSerial(page);
  await page.goto(process.env.LINK_TEST_URL ?? 'http://127.0.0.1:5180/');
  await expect(page.locator('.simulator-empty')).toHaveText('SIMULATOR');
  await expect.poll(() => page.locator('.device-frame, .simulator-empty img').evaluateAll(images =>
    images.length === 2 && images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)
  )).toBe(true);
  // The physical screen boundary must sit above both the idle artwork and
  // the running canvas, without capturing pointer input or changing layout.
  const boundary = () => page.locator('.device-screen').evaluate(element => {
    const style = getComputedStyle(element, '::after');
    return { content: style.content, border: style.borderTopWidth, position: style.position, inset: style.inset, zIndex: style.zIndex, pointerEvents: style.pointerEvents };
  });
  const expectedBoundary = { content: '""', border: '1px', position: 'absolute', inset: '0px', zIndex: '1', pointerEvents: 'none' };
  expect(await boundary()).toEqual(expectedBoundary);
  const boot = await readFile('public/device/simulator-boot.svg', 'utf8');
  expect(boot).toContain('<path d="M77.78 178.384'); // Original RYZOBEE lettering.
  expect(boot).not.toContain('<path d="M94.06 224.684'); // Only STARTING is replaced.
  const footer = await page.locator('.device-screen').evaluate(element => {
    const screen = element.getBoundingClientRect();
    const label = element.querySelector('.simulator-empty span')!;
    const box = label.getBoundingClientRect();
    const style = getComputedStyle(label);
    return { y: (box.top - screen.top) / screen.height * 240, height: box.height / screen.height * 240, font: style.fontFamily, weight: style.fontWeight };
  });
  expect(footer.y).toBeCloseTo(214, 0);
  expect(footer.height).toBeCloseTo(16, 0);
  expect(footer.font).toContain('Noto Sans');
  expect(footer.weight).toBe('500');
  await expect(page.getByRole('region', { name: '设备文件' }).locator('.panel-heading .muted')).toHaveCount(0);
  await expect(page.getByText('设备 / · Web Serial', { exact: true })).toHaveCount(0);
  const toggle = page.locator('.simulator-toggle');
  await expect(toggle).toHaveCount(1);
  await expect(toggle).toHaveAttribute('aria-label', '运行');
  await expect(toggle.locator('.codicon-play')).toBeVisible();
  expect(await toggle.evaluate(element => getComputedStyle(element).borderTopWidth)).toBe('0px');
  expect(await toggle.textContent()).toBe('');
  await page.screenshot({ path: 'test-results/compact-controls-idle.png' });
  await page.getByRole('button', { name: '运行', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '运行中' })).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-label', '停止');
  await expect(toggle.locator('.codicon-debug-stop')).toBeVisible();
  await page.screenshot({ path: 'test-results/compact-controls-running.png' });
  expect(await boundary()).toEqual(expectedBoundary);
  const simulator = page.getByRole('region', { name: 'UI 模拟器', exact: true });
  const statusLayout = await simulator.evaluate(element => {
    const status = element.querySelector('.simulator-state')!.getBoundingClientRect();
    const run = element.querySelector('.simulator-toggle')!.getBoundingClientRect();
    return { statusRight: status.right, runLeft: run.left, centerDifference: Math.abs(status.y + status.height / 2 - run.y - run.height / 2) };
  });
  expect(statusLayout.statusRight).toBeLessThanOrEqual(statusLayout.runLeft);
  expect(statusLayout.centerDifference).toBeLessThanOrEqual(1);
  const screen = page.getByLabel('240×240 交互模拟屏幕');
  const pixels = () => screen.evaluate((element: HTMLCanvasElement) => {
    const rgba = element.getContext('2d')!.getImageData(0, 0, 240, 240).data;
    return Array.from(rgba).reduce((sum, value, index) => (sum + value * (index % 13 + 1)) >>> 0, 0);
  });
  await expect.poll(pixels).not.toBe(0);
  const original = await pixels();
  const bounds = (await screen.boundingBox())!;
  const button = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height * (180 / 240) };

  // A normal mouse up also causes lostpointercapture. It must not revoke the
  // completed click before the real Lua polling loop receives it.
  await page.mouse.click(button.x, button.y);
  await expect.poll(pixels, { timeout: 2000 }).not.toBe(original);
  await expect(page.locator('.log-text').filter({ hasText: /count\s+1/ })).toBeVisible();
  const clicked = await pixels();

  // Editing the draft neither expands the status nor restarts the running snapshot.
  await page.getByRole('textbox', { name: 'Lua 源码编辑器', exact: true }).focus();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.insertText('\n-- Draft changes apply only on the next Run.\n');
  await expect(simulator.getByRole('status')).toHaveText('运行中');
  await expect(simulator.getByRole('status')).toHaveAttribute('title', '运行中');
  expect(await pixels()).toBe(clicked);

  // Closing the only editor tab must not kill its running Lua snapshot.
  await page.getByRole('button', { name: '关闭 ui_demo.lua', exact: true }).click();
  await expect(page.locator('.editor-empty')).toBeVisible();
  await expect(simulator.getByRole('status')).toHaveText('运行中');
  await expect(simulator.getByRole('button')).toHaveCount(1);
  await expect(simulator.getByRole('button', { name: '停止', exact: true })).toBeEnabled();
  expect(await pixels()).toBe(clicked);

  // The browser can cancel an in-progress touch; do not turn it into a click.
  await page.mouse.move(button.x, button.y);
  await page.mouse.down();
  await screen.dispatchEvent('pointercancel', { pointerId: 1, pointerType: 'mouse', isPrimary: true });
  await page.mouse.up();
  await page.waitForTimeout(150);
  expect(await pixels()).toBe(clicked);

  // Capture loss without a matching up is cancellation too, not activation.
  await page.mouse.down();
  // setPointerCapture takes effect before the next pointer event; establish
  // actual capture, rather than merely cancelling a pending capture request.
  await page.mouse.move(button.x + 1, button.y);
  await screen.evaluate((element: HTMLCanvasElement) => {
    if (element.hasPointerCapture(1)) element.releasePointerCapture(1);
  });
  await page.mouse.up();
  await page.waitForTimeout(150);
  expect(await pixels()).toBe(clicked);

  // Keep enough real simulator output to exercise the virtual list when a
  // paused user changes from a long source to a much shorter one.
  for (let count = 2; count <= 18; count++) {
    await page.mouse.click(button.x, button.y);
    await expect(page.locator('.log-text').filter({ hasText: new RegExp(`^count\\s+${count}$`) })).toBeVisible();
  }
  await page.getByRole('button', { name: '停止', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '未运行' })).toBeVisible();
  expect(await boundary()).toEqual(expectedBoundary);
  await expect(page.locator('.simulator-empty')).toHaveText('SIMULATOR');
  await expect(toggle).toHaveAttribute('aria-label', '运行');
  await expect(toggle).toBeDisabled();

  // Source tabs use the actual UI and stream peer; no production-only test
  // hooks or real serial hardware are involved.
  await page.getByRole('button', { name: '连接', exact: true }).click();
  await page.getByRole('button', { name: 'welcome.lua 文件操作', exact: true }).click();
  await page.getByRole('group', { name: 'welcome.lua 操作', exact: true }).getByRole('button', { name: '在设备运行', exact: true }).click();
  const exportedSource = '-- shortcut export\nprint("Ctrl+S")\n';
  await page.getByLabel('打开本地 Lua 文件', { exact: true }).setInputFiles({ name: 'shortcut_export.lua', mimeType: 'text/plain', buffer: Buffer.from(exportedSource) });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Lua 源码编辑器', exact: true }).focus();
  for (const shortcut of ['Control+s', 'Meta+s']) {
    const downloading = page.waitForEvent('download');
    await page.keyboard.press(shortcut);
    const download = await downloading;
    expect(download.suggestedFilename()).toBe('shortcut_export.lua');
    expect(await readFile((await download.path())!, 'utf8')).toBe(exportedSource);
  }
  await page.getByRole('textbox', { name: 'Lua 文件名' }).fill('bad/name.lua');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.locator('header .header-notice')).toContainText('文件名需为');
  await page.getByRole('textbox', { name: 'Lua 文件名' }).fill('shortcut_export.lua');

  const logs = page.getByRole('region', { name: '日志', exact: true });
  const tab = (name: string) => logs.getByRole('tab', { name, exact: true });
  const rows = logs.locator('.log-line');
  const rowCount = async () => Number((await logs.locator('.log-count').innerText()).match(/\d+/)![0]);
  await expect(logs.locator('.log-footer')).toHaveCount(0);
  await expect(logs.getByRole('tablist', { name: '日志来源' })).toBeVisible();
  await expect(tab('全部')).toHaveAttribute('aria-selected', 'true');
  await expect(logs.getByRole('tab')).toHaveCount(4);
  const allCount = await rowCount();

  await tab('全部').focus();
  await tab('全部').press('ArrowRight');
  await expect(tab('设备串口')).toBeFocused();
  await expect(tab('设备串口')).toHaveAttribute('aria-selected', 'true');
  await expect(logs.getByRole('tabpanel', { name: '设备串口', exact: true })).toBeVisible();
  await expect(rows.first()).toBeVisible();
  expect(await rows.locator('.log-source').allTextContents()).toEqual(expect.arrayContaining(['[serial]']));
  expect((await rows.locator('.log-source').allTextContents()).every(source => source === '[serial]')).toBe(true);

  await tab('设备串口').press('ArrowLeft');
  await expect(tab('全部')).toBeFocused();
  await tab('全部').press('End');
  await expect(tab('Link')).toBeFocused();
  await expect(logs.getByRole('tabpanel', { name: 'Link', exact: true })).toBeVisible();
  await expect(rows.first()).toBeVisible();
  expect((await rows.locator('.log-source').allTextContents()).every(source => source === '[link]')).toBe(true);
  await tab('Link').press('ArrowRight');
  await expect(tab('全部')).toBeFocused();
  await tab('全部').press('ArrowLeft');
  await expect(tab('Link')).toBeFocused();
  await tab('Link').press('Home');
  await expect(tab('全部')).toBeFocused();
  expect(await logs.getByRole('tab').evaluateAll(elements => elements.filter(element => element.getAttribute('tabindex') === '0').length)).toBe(1);

  await tab('模拟器').click();
  await expect(rows.first()).toBeVisible();
  expect((await rows.locator('.log-source').allTextContents()).every(source => source === '[simulator]')).toBe(true);
  expect(await rowCount()).toBeLessThan(allCount);
  await expect.poll(() => logs.getByRole('tabpanel').evaluate(element => element.scrollTop)).toBeGreaterThan(100);
  await logs.getByRole('button', { name: '暂停滚动', exact: true }).click();
  await tab('Link').click();
  await expect(logs.getByRole('button', { name: '继续滚动', exact: true })).toBeVisible();
  await expect(rows.first()).toBeVisible();
  await expect(logs.getByRole('tabpanel')).toHaveJSProperty('scrollTop', 0);
  await expect(logs.locator('.log-text').filter({ hasText: '设备已开始运行。' })).toBeVisible();
  await expect(logs.locator('.log-text').filter({ hasText: '文件名需为' })).toBeVisible();

  await logs.getByRole('combobox', { name: '日志级别' }).selectOption('error');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('文件名需为');
  await expect(rows.first().locator('.log-source')).toHaveText('[link]');
  await logs.getByRole('combobox', { name: '日志级别' }).selectOption('info');
  await expect(logs.locator('.log-text').filter({ hasText: '设备已开始运行。' })).toBeVisible();
  expect((await rows.locator('.log-level').allTextContents()).every(level => level === 'INFO')).toBe(true);
  await logs.getByRole('combobox', { name: '日志级别' }).selectOption('all');
  await tab('全部').click();
  expect(await rowCount()).toBe(allCount);

  // A wrapped toolbar must leave at least one full log row in short windows.
  for (const [width, height] of [[1440, 1000], [1024, 600], [1366, 560], [360, 640]]) {
    await page.setViewportSize({ width, height });
    const layout = await logs.evaluate(element => {
      const viewport = element.querySelector('.log-viewport')!;
      const style = getComputedStyle(viewport);
      return {
        pageWidth: document.documentElement.scrollWidth,
        contentHeight: viewport.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
        actionsWidth: element.querySelector('.log-actions')!.getBoundingClientRect().width,
        panelWidth: element.getBoundingClientRect().width,
      };
    });
    expect(layout.pageWidth).toBeLessThanOrEqual(width);
    expect(layout.contentHeight, `${width}x${height} log row area`).toBeGreaterThanOrEqual(26);
    expect(layout.actionsWidth).toBeLessThan(layout.panelWidth);
    const countBox = (await logs.locator('.log-count').boundingBox())!;
    const levelBox = (await logs.getByRole('combobox', { name: '日志级别' }).boundingBox())!;
    expect(countBox.x + countBox.width).toBeLessThan(levelBox.x);
    expect(Math.abs(countBox.y + countBox.height / 2 - levelBox.y - levelBox.height / 2)).toBeLessThan(1);
    if (width === 1440 || width === 360) await logs.screenshot({ path: `test-results/log-count-${width}.png` });
  }
  await logs.getByRole('button', { name: '清空视图', exact: true }).click();
  for (const name of ['全部', '设备串口', '模拟器', 'Link']) {
    await tab(name).click();
    await expect(logs.getByText('暂无日志', { exact: true })).toBeVisible();
    await expect(logs.locator('.log-count')).toHaveText('0 行');
  }

  // Actual Lua failures use the V5 screen; raw diagnostics belong only to Link.
  await page.setViewportSize({ width: 1440, height: 1000 });
  const files = page.getByLabel('打开本地 Lua 文件', { exact: true });
  await files.setInputFiles({ name: 'led_demo.lua', mimeType: 'text/plain',
    buffer: Buffer.from('-- ryz-app/1\n-- 2\n-- 3\n-- 4\n-- 5\n-- 6\nrequire("led")') });
  await simulator.getByRole('button', { name: '运行', exact: true }).click();
  const fault = simulator.getByRole('group', { name: '模拟器故障页面' });
  await expect(fault).toBeVisible();
  await expect(fault.locator('.fault-summary')).toHaveText('模拟器仅能模拟纯UI的界面');
  await expect(fault.locator('.fault-file')).toHaveText('led_demo.lua');
  await expect(fault.locator('.fault-line')).toHaveText('LINE 7');
  await expect(page.locator('.editor-status')).toHaveText('第 7 行 · 模拟器限制');
  await expect(page.locator('.editor-status')).toHaveClass(/warning/);
  await expect(simulator).not.toContainText('module not allowed');
  await expect(page.locator('.simulator-error')).toHaveCount(0);
  await expect(logs.locator('.log-text').filter({ hasText: 'main.lua:7: module not allowed: led' })).toHaveCount(1);
  await page.waitForTimeout(200); // A queued done/frame must not replace the terminal fault.
  await expect(fault).toBeVisible();
  await page.screenshot({ path: 'test-results/simulator-fault-ui-only.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await simulator.screenshot({ path: 'test-results/simulator-fault-mobile.png' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await tab('模拟器').click();
  await expect(logs.locator('.log-text').filter({ hasText: 'module not allowed' })).toHaveCount(0);
  await logs.getByRole('combobox', { name: '日志级别' }).selectOption('info');
  await fault.getByRole('button', { name: 'VIEW LOG' }).click();
  await expect(tab('Link')).toHaveAttribute('aria-selected', 'true');
  await expect(logs.locator('.log-text').filter({ hasText: 'module not allowed' })).toHaveCount(1);
  await page.getByRole('button', { name: '新建 Lua 文件', exact: true }).first().click();
  await expect(fault.locator('.fault-file')).toHaveText('led_demo.lua');
  await fault.getByRole('button', { name: 'HOME', exact: true }).click();
  await expect(page.locator('.simulator-empty')).toHaveText('SIMULATOR');

  for (const [name, source, code, summary] of [
    ['bad_syntax.lua', '-- ryz-app/1\nlocal =', 'LUA-S01', 'Syntax error'],
    ['bad_runtime.lua', '-- ryz-app/1\nerror("test failure")', 'LUA-R01', 'Runtime error'],
  ]) {
    await files.setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(source) });
    await simulator.getByRole('button', { name: '运行', exact: true }).click();
    await expect(fault.locator('.fault-code')).toHaveText(code);
    await expect(fault.locator('.fault-summary')).toHaveText(summary);
    await expect(fault.locator('.fault-file')).toHaveText(name);
  }
  await page.screenshot({ path: 'test-results/simulator-fault-runtime.png' });
  await files.setInputFiles({ name: 'recovered.lua', mimeType: 'text/plain',
    buffer: Buffer.from('-- ryz-app/1\nlocal board=require("ryzobee")\nwhile true do board.sleep_ms(20) end') });
  await simulator.getByRole('button', { name: '运行', exact: true }).click();
  await expect(simulator.getByRole('status')).toHaveText('运行中');
  await expect(fault).toHaveCount(0);
  await simulator.getByRole('button', { name: '停止', exact: true }).click();
  await expect(page.locator('.simulator-empty')).toHaveText('SIMULATOR');
});
