import { expect, test } from '@playwright/test';

test.describe('A股关键链路 smoke', () => {
  test('首页搜索贵州茅台可进入详情页', async ({ page }) => {
    await page.goto('/');

    await page.getByPlaceholder('输入股票代码或名称 (如 600519、000001、贵州茅台)...').fill('贵州茅台');
    await page.getByRole('button', { name: '分析' }).click();

    await expect(page).toHaveURL(/\/stock\/.+/);
    await expect(page.getByText('600519.SS')).toBeVisible();
    await expect(page.getByRole('button', { name: 'AI 分析' })).toBeVisible();
  });

  test('首页中文搜索可进入个股详情页', async ({ page }) => {
    await page.goto('/');

    await page.getByPlaceholder('输入股票代码或名称 (如 600519、000001、贵州茅台)...').fill('东山精密');
    await page.getByRole('button', { name: '分析' }).click();

    await expect(page).toHaveURL(/\/stock\/.+/);
    await expect(page.getByText('002384.SZ')).toBeVisible();
    await expect(page.getByRole('button', { name: 'AI 分析' })).toBeVisible();
  });

  test('首页搜索宁德时代可进入详情页', async ({ page }) => {
    await page.goto('/');

    await page.getByPlaceholder('输入股票代码或名称 (如 600519、000001、贵州茅台)...').fill('宁德时代');
    await page.getByRole('button', { name: '分析' }).click();

    await expect(page).toHaveURL(/\/stock\/.+/);
    await expect(page.getByText('300750.SZ')).toBeVisible();
    await expect(page.getByRole('button', { name: '事件驱动重算' })).toBeVisible();
  });

  test('个股详情页可加载行情与 AI 模块入口', async ({ page }) => {
    await page.goto('/stock/600519');

    await expect(page.getByText('600519.SS')).toBeVisible();
    await expect(page.getByText('预警中心')).toBeVisible();
    await expect(page.getByRole('button', { name: 'AI 分析' })).toBeVisible();
    await expect(page.getByRole('button', { name: '事件驱动重算' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'AI 盘中快评' })).toBeVisible();
  });

  test('事件驱动重算可成功返回并展示事件信号模块', async ({ page }) => {
    await page.goto('/stock/600519');

    const responsePromise = page.waitForResponse((response) =>
      response.url().includes('/api/stock/analysis/event-refresh') && response.request().method() === 'POST',
    );

    await page.getByRole('button', { name: '事件驱动重算' }).click();
    const response = await responsePromise;

    expect(response.status()).toBe(200);
    await expect(page.getByRole('heading', { name: '事件驱动信号' })).toBeVisible();
  });
});
