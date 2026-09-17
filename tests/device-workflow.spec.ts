import { expect, test } from '@playwright/test';
import { installSerial, serialRequests } from './fake-serial';

test('unsupported serial is reported once only in Link logs', async ({ page }) => {
  await page.addInitScript(() => {
    let owner: object | null = navigator;
    while (owner && !Object.hasOwn(owner, 'serial')) owner = Object.getPrototypeOf(owner);
    if (owner) Reflect.deleteProperty(owner, 'serial');
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: '连接', exact: true })).toBeDisabled();
  await expect(page.locator('header')).not.toContainText('Web Serial');
  await expect(page.getByRole('region', { name: '设备文件' })).not.toContainText('Web Serial');
  const logs = page.getByRole('region', { name: '日志', exact: true });
  await logs.getByRole('tab', { name: 'Link', exact: true }).click();
  const warning = logs.locator('.log-line.warn').filter({ hasText: '当前环境不支持 Web Serial' });
  await expect(warning).toHaveCount(1);
  await page.getByRole('button', { name: '新建 Lua 文件', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Lua 文件名' })).toHaveValue('untitled_1.lua');
  await expect(warning).toHaveCount(1);
  await page.screenshot({ path: 'test-results/serial-unsupported-log.png' });
  await logs.getByRole('button', { name: '清空视图', exact: true }).click();
  await page.getByRole('button', { name: '新建 Lua 文件', exact: true }).click();
  await expect(warning).toHaveCount(0);
});

test('connecting discovers real files and capacity without a manual refresh', async ({ page }) => {
  await installSerial(page, { fileCount: 30 });
  await page.goto('/');
  await expect(page.locator('.global-actions > button')).toHaveText(['打开', '保存', '发送', '连接']);
  await expect(page.locator('header')).not.toContainText('Web Serial');
  await expect(page.locator('.log-text').filter({ hasText: 'Web Serial' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '打开', exact: true })).toHaveAttribute('title', /^打开本地 Lua 文件（(Ctrl|⌘)\+O）$/);
  await expect(page.getByRole('button', { name: '保存', exact: true })).toHaveAttribute('title', /(Ctrl|⌘)\+S/);
  await expect(page.getByRole('button', { name: '发送', exact: true })).toHaveAttribute('title', /^发送当前 Lua 到设备（(Ctrl|⌘)\+Shift\+Enter）$/);
  await expect(page.getByRole('button', { name: '连接', exact: true })).toHaveAttribute('title', '连接设备');
  await page.getByRole('button', { name: '连接', exact: true }).click();
  await expect(page.getByRole('button', { name: '断开', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '断开', exact: true })).toHaveAttribute('title', '断开设备连接');
  await expect(page.getByRole('region', { name: '设备文件' }).getByText('welcome.lua', { exact: true })).toBeVisible();
  const fileCount = page.getByRole('region', { name: '设备文件' }).locator('.panel-heading .muted');
  await expect(fileCount).toHaveText('0 / 30 项');
  await expect(page.getByText('20% · 20.0 KB', { exact: true })).toBeVisible();
  const requests = await serialRequests(page);
  expect(requests.some(request => request.action === 'catalog')).toBe(true);
  expect(requests.some(request => request.action === 'status')).toBe(true);
  await expect(page.getByRole('button', { name: '读取选中', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '刷新', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '打开', exact: true })).toHaveCount(1);
  await expect(page.locator('.file-actions')).toHaveCount(0);
  const welcome = page.getByRole('button', { name: /^welcome\.lua \d+ B$/ });
  const welcomeRow = page.locator('.file-row').filter({ has: welcome });
  await welcome.hover();
  await expect(welcomeRow).toHaveCSS('border-top-color', 'rgb(255, 106, 0)');
  await expect(welcome).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(welcomeRow).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await page.getByRole('region', { name: '设备文件' }).screenshot({ path: 'test-results/file-hover-unselected.png' });
  await page.getByRole('button', { name: /^welcome\.lua \d+ B$/ }).dblclick();
  await expect(fileCount).toHaveText('1 / 30 项');
  await expect(welcomeRow).toHaveCSS('border-top-color', 'rgb(255, 106, 0)');
  await expect(welcome).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  const selectedBackground = await welcomeRow.evaluate(element => getComputedStyle(element).backgroundColor);
  await page.getByRole('button', { name: 'welcome.lua 文件操作', exact: true }).hover();
  await expect(page.getByRole('button', { name: 'welcome.lua 文件操作', exact: true })).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await page.getByRole('region', { name: '设备文件' }).screenshot({ path: 'test-results/file-hover-selected.png' });
  await page.getByRole('link', { name: 'RYZOBEE LINK', exact: true }).hover();
  await expect(welcomeRow).toHaveCSS('background-color', selectedBackground);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Lua 编辑器' }).getByRole('status')).toHaveText('已写入设备 · 校验通过');
  const reads = (await serialRequests(page)).filter(request => request.op === 'get').length;
  await page.getByRole('button', { name: 'welcome.lua 文件操作', exact: true }).click();
  await page.getByRole('group', { name: 'welcome.lua 操作', exact: true }).getByRole('button', { name: '读取到编辑器', exact: true }).click();
  await expect.poll(async () => (await serialRequests(page)).filter(request => request.op === 'get').length).toBe(reads + 1);

  // Large catalogs and running jobs must not push storage or logs below the window.
  await page.evaluate(() => document.fonts.ready);
  await page.getByRole('button', { name: 'welcome.lua 文件操作', exact: true }).click();
  await page.getByRole('group', { name: 'welcome.lua 操作', exact: true }).getByRole('button', { name: '在设备运行', exact: true }).click();
  await expect(page.locator('.device-job')).toContainText('welcome.lua');
  await expect(page.locator('.file-row')).toHaveCount(30);
  for (const [width, height] of [[1470, 866], [1366, 768], [1280, 720], [1024, 768], [1440, 1000], [1280, 650], [1024, 650], [1280, 600], [1366, 560], [1024, 600]]) {
    await page.setViewportSize({ width, height });
    const layout = await page.evaluate(() => {
      const box = (selector: string) => {
        const rect = document.querySelector(selector)!.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, width: rect.width, height: rect.height };
      };
      const list = document.querySelector('.file-list')!;
      return {
        pageWidth: document.documentElement.scrollWidth,
        pageHeight: document.documentElement.scrollHeight,
        gaps: ['.workbench', '.workspace-grid', '.left-column', '.right-column'].map(selector => getComputedStyle(document.querySelector(selector)!).gap),
        panels: ['.simulator-panel', '.files-panel', '.editor-panel', '.logs-panel', '.storage', '.log-count', '.device-job'].map(box),
        canvas: box('.device-shell canvas'),
        listHeight: list.clientHeight,
        listScrollable: list.scrollHeight > list.clientHeight && getComputedStyle(list).overflowY === 'auto',
      };
    });
    const label = width + 'x' + height;
    expect(layout.gaps).toEqual(['8px', '8px', '8px', '8px']);
    expect(layout.pageWidth, label + ' page width').toBeLessThanOrEqual(width);
    expect(layout.pageHeight, label + ' page height').toBeLessThanOrEqual(height);
    for (const box of layout.panels) {
      expect(box.top).toBeGreaterThanOrEqual(0);
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.bottom).toBeLessThanOrEqual(height + 0.5);
      expect(box.right).toBeLessThanOrEqual(width + 0.5);
    }
    expect(Math.abs(layout.canvas.width - layout.canvas.height)).toBeLessThan(0.5);
    expect(layout.listHeight, label + ' usable file list').toBeGreaterThanOrEqual(40);
    expect(layout.listScrollable).toBe(true);
    if (width === 1280 && height === 720) {
      await page.locator('header').screenshot({ path: 'test-results/header-actions-desktop.png' });
      await page.screenshot({ path: 'test-results/panel-gaps-desktop.png' });
    }
  }

  // Menus must escape the internal list scrollport; being in the DOM is insufficient.
  await page.setViewportSize({ width: 1280, height: 720 });
  for (const name of ['welcome.lua', 'example_29.lua']) {
    const trigger = page.getByRole('button', { name: name + ' 文件操作', exact: true });
    await trigger.click();
    const menu = page.getByRole('group', { name: name + ' 操作', exact: true });
    await expect(menu).toBeVisible();
    const accessible = await menu.evaluate(element => [...element.querySelectorAll('button')].map(button => {
      const box = button.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return box.top >= 0 && box.bottom <= innerHeight && (button === hit || button.contains(hit));
    }));
    expect(accessible).toEqual([true, true, true, true]);
    await page.screenshot({ path: 'test-results/layout-menu-' + name + '.png' });
    await trigger.click();
  }

  // Narrow windows may scroll vertically, but must keep a usable simulator and controls.
  for (const [width, height] of [[900, 650], [800, 600], [721, 600], [720, 800], [390, 844], [360, 640]]) {
    await page.setViewportSize({ width, height });
    const layout = await page.evaluate(() => {
      const canvas = document.querySelector('.device-shell canvas')!.getBoundingClientRect();
      const list = document.querySelector('.file-list')!;
      return {
        pageWidth: document.documentElement.scrollWidth,
        canvas: { width: canvas.width, height: canvas.height },
        gaps: ['.workbench', '.workspace-grid', '.left-column', '.right-column'].map(selector => getComputedStyle(document.querySelector(selector)!).gap),
        listHeight: list.clientHeight,
        listScrollable: list.scrollHeight > list.clientHeight && getComputedStyle(list).overflowY === 'auto',
        headerControls: [...document.querySelectorAll('.global-bar button')].map(button => {
          const box = button.getBoundingClientRect();
          return { left: box.left, right: box.right, height: box.height };
        }),
      };
    });
    expect(layout.pageWidth).toBeLessThanOrEqual(width);
    expect(layout.canvas.width).toBeGreaterThanOrEqual(180);
    expect(layout.gaps).toEqual(Array(4).fill(width <= 720 ? '4px' : '8px'));
    expect(Math.abs(layout.canvas.width - layout.canvas.height)).toBeLessThan(0.5);
    expect(layout.listHeight).toBeGreaterThanOrEqual(40);
    expect(layout.listScrollable).toBe(true);
    for (const button of layout.headerControls) {
      expect(button.left).toBeGreaterThanOrEqual(0);
      expect(button.right).toBeLessThanOrEqual(width);
      expect(button.height).toBeGreaterThanOrEqual(30);
    }
    if (width === 360) {
      const rows = await page.locator('.global-actions > button').evaluateAll(buttons => buttons.map(button => button.getBoundingClientRect().top));
      expect(new Set(rows).size).toBe(1);
      await page.locator('header').screenshot({ path: 'test-results/header-actions-mobile.png' });
      await page.screenshot({ path: 'test-results/panel-gaps-mobile.png', fullPage: true });
    }
  }

  // An already-completed scroll can dispatch after the menu opens on a small screen.
  const mobileTrigger = page.getByRole('button', { name: 'welcome.lua 文件操作', exact: true });
  const mobileMenu = page.getByRole('group', { name: 'welcome.lua 操作', exact: true });
  await mobileTrigger.click();
  await expect(mobileMenu).toBeVisible();
  await page.evaluate(() => {
    window.dispatchEvent(new Event('scroll'));
    document.querySelector('.file-list')!.dispatchEvent(new Event('scroll'));
  });
  await expect(mobileMenu).toBeVisible();
  await page.evaluate(() => window.scrollBy(0, 80));
  await expect(mobileMenu).not.toBeVisible();
  await mobileTrigger.click();
  await expect(mobileMenu).toBeVisible();
  await page.locator('.file-list').evaluate(list => { list.scrollTop += 50; });
  await expect(mobileMenu).not.toBeVisible();
});

test('unchecking automatic run uploads and refreshes files without starting the simulator or device', async ({ page }) => {
  await installSerial(page);
  await page.goto('/');
  await page.getByRole('button', { name: '连接', exact: true }).click();
  await page.getByRole('textbox', { name: 'Lua 文件名' }).fill('link_uploaded.lua');
  await page.evaluate(() => document.fonts.ready);
  const before = await page.locator('.workspace-grid').boundingBox();
  await page.getByRole('button', { name: '发送', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('checkbox', { name: '发送后自动运行' })).toBeChecked();
  await dialog.getByRole('checkbox', { name: '发送后自动运行' }).uncheck();
  await dialog.getByRole('button', { name: '确认', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('header .header-notice')).toHaveText('已写入设备，校验通过。');
  expect((await page.locator('.workspace-grid').boundingBox())?.y).toBe(before?.y);
  await expect(page.locator('.workbench > .notice')).toHaveCount(0);
  await expect(page.getByRole('region', { name: '设备文件' }).getByText('link_uploaded.lua', { exact: true })).toBeVisible();
  const requests = await serialRequests(page);
  const put = requests.findIndex(request => request.action === 'put');
  expect(put).toBeGreaterThan(0);
  expect(requests.slice(put + 1).some(request => request.action === 'catalog')).toBe(true);
  expect(requests.filter(request => request.action === 'put')).toHaveLength(1);
  expect(requests.some(request => request.op === 'console')).toBe(false);
});

test('run rejection after committed upload closes the write dialog and reports partial success without repeating put', async ({ page }) => {
  await installSerial(page, { failRun: true });
  await page.goto('/');
  await page.getByRole('button', { name: '连接', exact: true }).click();
  await page.getByRole('textbox', { name: 'Lua 文件名' }).fill('link_run_failure.lua');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('checkbox', { name: '发送后自动运行' })).toBeChecked();
  await dialog.getByRole('button', { name: '确认', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const notice = page.locator('header').getByRole('alert').filter({ hasText: /已写入.*启动失败/ });
  await expect(notice).toBeVisible();
  await expect(notice.locator('.notice-text')).toHaveAttribute('title', /已写入.*启动失败/);
  await expect(page.getByRole('region', { name: '设备文件' }).getByText('link_run_failure.lua', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '确认', exact: true })).toHaveCount(0);
  const requests = await serialRequests(page);
  expect(requests.filter(request => request.action === 'put')).toHaveLength(1);
  expect(requests.filter(request => request.command === 'lua --run-async --path link_run_failure.lua')).toHaveLength(1);
  for (const width of [1440, 1100, 1024, 900, 720]) {
    await page.setViewportSize({ width, height: 1000 });
    const layout = await page.locator('header').evaluate(header => {
      const message = header.querySelector('.header-notice')!.getBoundingClientRect();
      const actions = header.querySelector('.global-actions')!.getBoundingClientRect();
      return { messageRight: message.right, messageBottom: message.bottom, actionsLeft: actions.left, actionsTop: actions.top, height: header.getBoundingClientRect().height, scrollWidth: document.documentElement.scrollWidth };
    });
    if (width > 950) expect(layout.messageRight).toBeLessThanOrEqual(layout.actionsLeft);
    else expect(layout.messageBottom).toBeLessThanOrEqual(layout.actionsTop);
    expect(layout.scrollWidth).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `test-results/header-notice-${width}.png` });
    const beforeDismiss = await page.locator('.workspace-grid').boundingBox();
    // Clearing the banner may not move the workbench or hide connection state.
    if (width === 720) {
      await notice.getByRole('button', { name: '关闭消息' }).click();
      await expect(page.locator('.header-notice')).toHaveCount(0);
      expect((await page.locator('.workspace-grid').boundingBox())?.y).toBe(beforeDismiss?.y);
      await expect(page.locator('header .connection')).toHaveText('已连接');
    }
  }
});
