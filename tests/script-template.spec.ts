import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('every new document has firmware metadata without rewriting imports or saved drafts', async ({ page }) => {
  await page.goto('/');
  const filename = page.getByRole('textbox', { name: 'Lua 文件名' });
  await expect(filename).toHaveValue('ui_demo.lua');
  const expectedHeader = [
    '-- ryz-app/1', '-- @author: Unknown', '-- @version: 0.1.0',
    '-- @description: 空白 Lua 应用，尚未添加功能。',
  ];
  async function exported(name: string) {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    const download = await pending;
    expect(download.suggestedFilename()).toBe(name);
    await download.saveAs('test-results/script-headers/' + name);
    return readFile((await download.path())!, 'utf8');
  }
  const demo = await exported('ui_demo.lua');
  expect(demo.split('\n').slice(0, 4)).toEqual([
    ...expectedHeader.slice(0, 3), '-- @description: 点击按钮递增计数，并输出当前计数。',
  ]);
  for (const index of [1, 2]) {
    await page.getByRole('button', { name: '新建 Lua 文件', exact: true }).click();
    await expect(filename).toHaveValue(`untitled_${index}.lua`);
    const source = await exported(`untitled_${index}.lua`);
    expect(source.split('\n').slice(0, 4)).toEqual(expectedHeader);
    expect(new TextEncoder().encode(source).length).toBeLessThanOrEqual(16384);
    for (const field of ['author', 'version', 'description']) expect(source.match(new RegExp(`^-- @${field}:`, 'gm'))).toHaveLength(1);
  }
  await page.getByRole('region', { name: 'Lua 编辑器' }).screenshot({ path: 'test-results/new-script-header.png' });
  const edited = '-- ryz-app/1\n-- @author: Test author\n-- @version: 0.2.0\n-- @description: User edited description.\n';
  await filename.fill('edited.lua');
  const editor = page.getByRole('textbox', { name: 'Lua 源码编辑器', exact: true });
  await editor.focus();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(edited);
  await expect(page.locator('.editor-status')).toHaveAttribute('data-save-state', 'saved');
  await page.reload();
  await expect(filename).toHaveValue('edited.lua');
  expect(await exported('edited.lua')).toBe(edited);
  const legacy = '-- Existing script: preserve its entry point.\nprint("legacy")\n';
  await page.getByLabel('打开本地 Lua 文件', { exact: true }).setInputFiles({ name: 'legacy.lua', mimeType: 'text/plain', buffer: Buffer.from(legacy) });
  await expect(filename).toHaveValue('legacy.lua');
  expect(await exported('legacy.lua')).toBe(legacy);
  while (await page.locator('.tab-close').count()) await page.locator('.tab-close').last().click();
  for (const width of [1280, 360]) {
    await page.setViewportSize({ width, height: 800 });
    const empty = page.locator('.editor-empty');
    await expect(empty.locator(':scope > .codicon')).toHaveCSS('font-size', '64px');
    const buttons = await empty.locator('button').evaluateAll(elements => elements.map(element => {
      const rect = element.getBoundingClientRect();
      return { width: rect.width, height: rect.height, left: rect.left, right: rect.right };
    }));
    expect(buttons[0].width).toBe(buttons[1].width);
    for (const button of buttons) {
      expect(button.height).toBeGreaterThanOrEqual(44);
      expect(button.left).toBeGreaterThanOrEqual(0);
      expect(button.right).toBeLessThanOrEqual(width);
    }
    await page.getByRole('region', { name: 'Lua 编辑器' }).screenshot({ path: `test-results/editor-empty-${width}.png` });
  }
  await page.locator('.editor-empty').getByRole('button', { name: '新建 Lua 文件', exact: true }).click();
  await expect(filename).toHaveValue('untitled_1.lua');
  expect((await exported('untitled_1.lua')).split('\n').slice(0, 4)).toEqual(expectedHeader);
});
