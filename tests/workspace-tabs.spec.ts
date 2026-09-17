import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('documents switch independently, persist together and confirm only when leaving the page', async ({ page }) => {
  await page.goto('/');
  const fileIcon = page.locator('.editor-tab.active .codicon-file-code');
  await expect(fileIcon).toBeVisible();
  expect(await fileIcon.evaluate(element => getComputedStyle(element).fontFamily)).toContain('codicon');
  const input = page.getByLabel('打开本地 Lua 文件', { exact: true });
  await input.setInputFiles([
    { name: 'alpha.lua', mimeType: 'text/plain', buffer: Buffer.from('print("alpha")\n') },
    { name: 'beta.lua', mimeType: 'text/plain', buffer: Buffer.from('print("beta")\n') },
  ]);
  const tabs = page.getByRole('tablist', { name: '打开的 Lua 文件' });
  await expect(tabs.getByRole('tab')).toHaveCount(3);
  await expect(tabs.getByRole('tab', { name: 'beta.lua' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // Natural widths, then equal compression, before the minimum-width overflow case below.
  await page.setViewportSize({ width: 1800, height: 900 });
  const filename = page.getByRole('textbox', { name: 'Lua 文件名' });
  await filename.fill('a_long_descriptive_filename_for_layout.lua');
  const widths = () => page.locator('.editor-tab').evaluateAll(items => items.map(item => item.getBoundingClientRect().width));
  await expect.poll(async () => new Set(await widths()).size).toBeGreaterThan(1);
  await expect(page.locator('.active-file-name')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/workspace-tabs-natural.png' });
  const stripWidth = await tabs.evaluate(element => element.clientWidth);
  const activeWidth = (await widths())[2];
  await page.setViewportSize({ width: Math.round(1800 - stripWidth + activeWidth + 288), height: 900 });
  await expect.poll(async () => new Set((await widths()).slice(0, 2)).size).toBe(1);
  expect((await widths())[0]).toBeGreaterThan(120);
  expect((await widths())[2]).toBe(activeWidth);
  expect(await tabs.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(false);
  expect(await filename.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await expect(page.locator('.active-file-name')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/workspace-tabs-compressed.png' });
  await filename.fill('beta.lua');
  await tabs.getByRole('tab', { name: 'alpha.lua' }).click();
  const editor = page.getByRole('textbox', { name: 'Lua 源码编辑器', exact: true });
  await editor.focus();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText('print("edited alpha")\n');
  await tabs.getByRole('tab', { name: 'beta.lua' }).click();
  async function exported(name: string, source: string) {
    const pending = page.waitForEvent('download');
    await page.keyboard.press('ControlOrMeta+s');
    const download = await pending;
    expect(download.suggestedFilename()).toBe(name);
    expect(await readFile((await download.path())!, 'utf8')).toBe(source);
  }
  await exported('beta.lua', 'print("beta")\n');
  await tabs.getByRole('tab', { name: 'alpha.lua' }).click();
  await exported('alpha.lua', 'print("edited alpha")\n');
  // Opening a changed same-name file must not silently overwrite the edited tab.
  await input.setInputFiles({ name: 'alpha.lua', mimeType: 'text/plain', buffer: Buffer.from('print("another alpha")\n') });
  await expect(tabs.getByRole('tab')).toHaveCount(4);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.editor-status')).toHaveAttribute('data-save-state', 'saved');
  await expect(page.locator('.editor-status')).toBeEmpty();
  await page.screenshot({ path: 'test-results/workspace-tabs-desktop.png' });
  let leavePrompts = 0;
  page.on('dialog', async dialog => {
    expect(dialog.type()).toBe('beforeunload');
    leavePrompts++;
    await dialog.accept();
  });
  await page.reload();
  expect(leavePrompts).toBe(1);
  await expect(tabs.getByRole('tab')).toHaveCount(4);
  await page.getByRole('textbox', { name: 'Lua 文件名' }).focus();
  await exported('alpha.lua', 'print("another alpha")\n');
  await tabs.getByRole('tab', { name: 'alpha.lua' }).first().click();
  await exported('alpha.lua', 'print("edited alpha")\n');
  await page.getByRole('button', { name: '新建 Lua 文件' }).click();
  await expect(page.getByRole('textbox', { name: 'Lua 文件名' })).toHaveValue('untitled_1.lua');
  await expect(tabs.getByRole('tab')).toHaveCount(5);
  await input.setInputFiles(Array.from({ length: 12 }, (_, index) => ({
    name: 'long_file_name_for_horizontal_tab_' + index + '.lua', mimeType: 'text/plain', buffer: Buffer.from('-- ' + index),
  })));
  await expect(tabs.getByRole('tab')).toHaveCount(17);
  const tabLayout = () => page.locator('.editor-tabs-row').evaluate(row => {
    const strip = row.querySelector('.editor-tabs')!;
    const boxes = [...row.querySelectorAll('.editor-tab')].map(tab => tab.getBoundingClientRect());
    const name = row.querySelector('input')!.getBoundingClientRect();
    const status = row.querySelector('.editor-status')!.getBoundingClientRect();
    return { widths: boxes.map(box => box.width), tops: boxes.map(box => box.top), scrollable: strip.scrollWidth > strip.clientWidth,
      centerDifference: Math.abs(name.y + name.height / 2 - status.y - status.height / 2) };
  });
  let layout = await tabLayout();
  expect(new Set(layout.widths.slice(0, -1))).toEqual(new Set([120]));
  expect(layout.widths.at(-1)).toBeGreaterThan(120);
  expect(await filename.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await expect(page.getByRole('textbox', { name: 'Lua 文件名' })).toHaveAttribute('title', 'long_file_name_for_horizontal_tab_11.lua');
  expect(new Set(layout.tops).size).toBe(1);
  expect(layout.scrollable).toBe(true);
  expect(layout.centerDifference).toBeLessThan(1);
  expect(await page.locator('.editor-tab.active').evaluate(element =>
    Math.abs(element.getBoundingClientRect().bottom - document.querySelector('.editor-document')!.getBoundingClientRect().top))).toBeLessThanOrEqual(1);
  // Activating a previously truncated tab expands it in place.
  await tabs.getByRole('tab', { name: 'long_file_name_for_horizontal_tab_9.lua', exact: true }).click();
  expect(await filename.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await expect(filename).toHaveValue('long_file_name_for_horizontal_tab_9.lua');
  await expect(page.locator('.tab-close')).toHaveCount(17);
  await page.getByRole('button', { name: '关闭 beta.lua', exact: true }).click();
  await expect(filename).toHaveValue('long_file_name_for_horizontal_tab_9.lua');
  await page.getByRole('button', { name: '关闭 long_file_name_for_horizontal_tab_9.lua', exact: true }).click();
  await expect(filename).toHaveValue('long_file_name_for_horizontal_tab_10.lua');
  await page.screenshot({ path: 'test-results/workspace-tabs-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  layout = await tabLayout();
  expect(new Set(layout.tops).size).toBe(1);
  expect(layout.centerDifference).toBeLessThan(1);
  const closePosition = await page.locator('.editor-tab.active .tab-close').evaluate(element => ({
    right: element.getBoundingClientRect().right,
    stripRight: element.closest('.editor-tabs')!.getBoundingClientRect().right,
  }));
  expect(closePosition.right).toBeLessThanOrEqual(closePosition.stripRight);
  await page.getByRole('region', { name: 'Lua 编辑器' }).screenshot({ path: 'test-results/workspace-tabs-mobile.png' });
  while (await page.locator('.tab-close').count()) await page.locator('.tab-close').last().click();
  await expect(tabs.getByRole('tab')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '运行', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled();
  // Wait for the real IndexedDB transaction, including the empty workspace.
  await expect.poll(() => page.evaluate(() => new Promise<number>(resolve => {
    const request = indexedDB.open('ryzobee-link');
    request.onsuccess = () => {
      const db = request.result;
      const read = db.transaction('workspace').objectStore('workspace').get('tabs');
      read.onsuccess = () => { resolve(read.result.documents.length); db.close(); };
    };
  }))).toBe(0);
  await page.reload();
  await expect(page.locator('.editor-empty')).toBeVisible();
  await expect(tabs.getByRole('tab')).toHaveCount(0);
  await page.getByRole('button', { name: '新建 Lua 文件', exact: true }).first().click();
  await expect(filename).toHaveValue('untitled_1.lua');
});
