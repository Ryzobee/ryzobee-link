import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { installSerial, serialRequests } from './fake-serial';

test('shortcuts share live editor actions, block repeats and IME, and expose contextual hints', async ({ page }) => {
  await page.goto('/');
  const editor = page.getByRole('textbox', { name: 'Lua 源码编辑器', exact: true });
  const simulator = page.getByRole('region', { name: 'UI 模拟器' });
  await editor.focus();
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('ControlOrMeta+o');
  const source = '-- ryz-app/1\nlocal board = require("ryzobee")\nwhile true do board.sleep_ms(20) end\n';
  await (await chooser).setFiles({ name: 'hotkeys.lua', mimeType: 'text/plain', buffer: Buffer.from(source) });
  await expect(page.getByRole('textbox', { name: 'Lua 文件名' })).toHaveValue('hotkeys.lua');
  await editor.focus();
  await page.keyboard.press('ControlOrMeta+Shift+Enter'); // Disconnected: no write and no inserted line.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(simulator.getByRole('status')).toHaveText('运行中');
  await expect(simulator.getByRole('button', { name: '停止', exact: true })).toHaveAttribute('title', /^停止（(Ctrl|⌘)\+Enter）$/);
  const ignored = await page.evaluate(() => {
    const options = [
      { key: 'Enter', ctrlKey: true, repeat: true },
      { key: 'Enter', ctrlKey: true, isComposing: true },
      { key: 'Enter', ctrlKey: true, keyCode: 229 },
      { key: 'Enter', ctrlKey: true, altKey: true },
    ];
    return options.map(option => {
      const event = new KeyboardEvent('keydown', { ...option, cancelable: true });
      window.dispatchEvent(event); return event.defaultPrevented;
    });
  });
  expect(ignored).toEqual([true, false, false, false]);
  await expect(simulator.getByRole('status')).toHaveText('运行中');
  // Synthetic IME events exercise the app router only. A real key sent to
  // Monaco after a window-only compositionstart is not an OS IME sequence.
  expect(await page.evaluate(() => {
    window.dispatchEvent(new CompositionEvent('compositionstart'));
    const key = new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, cancelable: true });
    window.dispatchEvent(key);
    return key.defaultPrevented;
  })).toBe(false);
  await expect(simulator.getByRole('status')).toHaveText('运行中');
  await page.evaluate(() => window.dispatchEvent(new CompositionEvent('compositionend')));
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(simulator.getByRole('status')).toHaveText('未运行');
  // Both platform variants keep the exact source, even with Monaco focused.
  for (const key of ['Control+s', 'Meta+s']) {
    const pending = page.waitForEvent('download');
    await page.keyboard.press(key);
    const download = await pending;
    expect(download.suggestedFilename()).toBe('hotkeys.lua');
    expect(await readFile((await download.path())!, 'utf8')).toBe(source);
  }
  let downloads = 0;
  page.on('download', () => downloads++);
  await page.keyboard.press('F1');
  const help = page.getByRole('dialog', { name: '快捷键', exact: true });
  await expect(help).toBeVisible();
  await expect(help.getByText('运行 / 停止模拟器', { exact: true })).toBeVisible();
  for (const [width, height] of [[1280, 720], [360, 640]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => document.fonts.ready);
    const bounds = (await help.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    expect(await help.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: `test-results/shortcuts-help-${width}.png` });
  }
  await page.keyboard.press('ControlOrMeta+s');
  await page.keyboard.press('ControlOrMeta+Enter');
  await page.keyboard.press('F1');
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(simulator.getByRole('status')).toHaveText('未运行');
  expect(downloads).toBe(0);
  await page.keyboard.press('Escape');
  await expect(help).toHaveCount(0);
  while (await page.locator('.tab-close').count()) await page.locator('.tab-close').last().click();
  await page.keyboard.press('ControlOrMeta+s');
  await page.keyboard.press('ControlOrMeta+Enter');
  expect(downloads).toBe(0);
  await expect(simulator.getByRole('status')).toHaveText('未运行');
  await page.getByRole('button', { name: '快捷键', exact: true }).click();
  await expect(help).toBeVisible();
});

test('send shortcut prepares one confirmation and never writes through a modal', async ({ page }) => {
  await installSerial(page);
  await page.goto('/');
  await page.getByRole('button', { name: '连接', exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'Lua 源码编辑器', exact: true });
  await editor.focus();
  await page.keyboard.press('ControlOrMeta+Shift+Enter');
  const dialog = page.getByRole('dialog', { name: '发送脚本到设备', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('checkbox', { name: '发送后自动运行' })).toBeChecked();
  await dialog.getByRole('button', { name: '确认', exact: true }).focus();
  for (const key of ['ControlOrMeta+Shift+Enter', 'ControlOrMeta+Enter', 'ControlOrMeta+s', 'F1']) await page.keyboard.press(key);
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  expect((await serialRequests(page)).filter(request => request.action === 'put' || request.op === 'console')).toHaveLength(0);
  await dialog.getByRole('checkbox', { name: '发送后自动运行' }).uncheck();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await editor.focus();
  await page.keyboard.press('ControlOrMeta+Shift+Enter');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('checkbox', { name: '发送后自动运行' })).toBeChecked();
  await page.screenshot({ path: 'test-results/send-default-run.png' });
  await dialog.getByRole('button', { name: '确认', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('header .header-notice')).toHaveText('已写入设备并启动运行。');
  const requests = await serialRequests(page);
  expect(requests.filter(request => request.action === 'put')).toHaveLength(1);
  expect(requests.filter(request => request.command === 'lua --run-async --path ui_demo.lua')).toHaveLength(1);
  expect(requests.findIndex(request => request.op === 'console')).toBeGreaterThan(requests.findIndex(request => request.action === 'put'));
});
