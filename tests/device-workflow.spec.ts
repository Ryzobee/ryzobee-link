import { expect, test } from '@playwright/test';
import { installSerial, serialRequests } from './fake-serial';

test('connecting discovers real files and capacity without a manual refresh', async ({ page }) => {
  await installSerial(page);
  await page.goto('/');
  await page.getByRole('button', { name: '连接设备', exact: true }).click();
  await expect(page.getByRole('button', { name: '断开连接', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: '设备文件' }).getByText('welcome.lua', { exact: true })).toBeVisible();
  await expect(page.getByText('20% · 20.0 KB', { exact: true })).toBeVisible();
  const requests = await serialRequests(page);
  expect(requests.some(request => request.action === 'catalog')).toBe(true);
  expect(requests.some(request => request.action === 'status')).toBe(true);
  await page.getByRole('button', { name: /^welcome\.lua \d+ B$/ }).click();
  await page.getByRole('button', { name: '读取选中', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '替换草稿', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Lua 编辑器' }).getByRole('status')).toHaveText('已写入设备 · 校验通过');
});

test('a successful upload refreshes the file list without running the simulator or device', async ({ page }) => {
  await installSerial(page);
  await page.goto('/');
  await page.getByRole('button', { name: '连接设备', exact: true }).click();
  await page.getByRole('textbox', { name: 'Lua 文件名' }).fill('link_uploaded.lua');
  await page.getByRole('button', { name: '发送到设备', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('checkbox', { name: '发送后自动运行' })).not.toBeChecked();
  await dialog.getByRole('button', { name: '确认写入', exact: true }).click();
  await expect(dialog).not.toBeVisible();
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
  await page.getByRole('button', { name: '连接设备', exact: true }).click();
  await page.getByRole('textbox', { name: 'Lua 文件名' }).fill('link_run_failure.lua');
  await page.getByRole('button', { name: '发送到设备', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('checkbox', { name: '发送后自动运行' }).check();
  await dialog.getByRole('button', { name: '确认写入', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: /已写入.*启动失败/ })).toBeVisible();
  await expect(page.getByRole('region', { name: '设备文件' }).getByText('link_run_failure.lua', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '确认写入', exact: true })).toHaveCount(0);
  const requests = await serialRequests(page);
  expect(requests.filter(request => request.action === 'put')).toHaveLength(1);
  expect(requests.filter(request => request.command === 'lua --run-async --path link_run_failure.lua')).toHaveLength(1);
});
