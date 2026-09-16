import { expect, test } from '@playwright/test';

test.use({ channel: 'chrome', viewport: { width: 1440, height: 1000 } });

test('real Lua screen accepts a completed click but not cancelled pointer capture', async ({ page }) => {
  await page.goto(process.env.LINK_TEST_URL ?? 'http://127.0.0.1:5180/');
  await page.getByRole('button', { name: '运行', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '运行中' })).toBeVisible();
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

  await page.getByRole('button', { name: '停止', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '未运行' })).toBeVisible();
});
