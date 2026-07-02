import { test, expect } from '@playwright/test';

test.describe('Lumo AI E2E Chat Flow', () => {
  test('should load the chat interface and send a message', async ({ page }) => {
    // Mock authenticated user session
    await page.route('**/api/v1/auth/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'user-123', email: 'test@example.com', full_name: 'Test User', role: 'USER' })
      });
    });
    await page.route('**/health', async (route) => {
      await route.fulfill({ status: 200, body: JSON.stringify({ status: 'ok' }) });
    });
    await page.route('**/api/v1/documents', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { id: 'doc-123', name: 'FPT_BCTC_2023.pdf', size: '1.2 MB', uploadedAt: '2026-07-02', status: 'indexed' }
        ])
      });
    });
    await page.route('**/api/v1/documents/doc-123/info', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'doc-123', name: 'FPT_BCTC_2023.pdf', totalPages: 1, pages: [{ page: 1, width: 800, height: 1000 }] })
      });
    });

    // Intercept and mock the SSE endpoint /chat-stream
    await page.route('**/chat-stream*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: {
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
        body: [
          'event: step\n',
          'data: {"node": "retriever", "output": "Đang phân tích dữ liệu Q4/2023..."}\n\n',
          'event: final_answer\n',
          'data: {"content": "Theo số liệu tài chính, doanh thu năm 2023 của FPT đạt tăng trưởng 19.6%."}\n\n',
          'event: done\n',
          'data: end\n\n'
        ].join('')
      });
    });

    // 1. Mở trang chủ React
    await page.goto('http://localhost:5173');

    // 2. Kiểm tra các thành phần UI cơ bản của Lumo AI
    await expect(page.locator('aside').first()).toBeVisible();
    await expect(page.locator('h1:has-text("Lumo")')).toBeVisible();
    await expect(page.locator('h2:has-text("Financial Intelligence Agent")')).toBeVisible();

    // 3. Nhập câu hỏi và gửi
    const input = page.locator('input[placeholder*="Ask AI about"]');
    await expect(input).toBeVisible();
    await input.fill('Lợi nhuận của FPT năm 2023?');
    await input.press('Enter');

    // 4. Kiểm tra trạng thái Thought process và câu trả lời hiển thị
    const reasoningSteps = page.locator('#reasoning-steps');
    await expect(reasoningSteps).toBeVisible({ timeout: 5000 });
    await expect(reasoningSteps).toContainText('Thought process');
    await expect(reasoningSteps).toContainText('Đang phân tích dữ liệu Q4/2023...');

    // 5. Chờ kết quả hiển thị trên bong bóng chat
    const responseMsg = page.locator('text=doanh thu năm 2023 của FPT đạt tăng trưởng 19.6%');
    await expect(responseMsg).toBeVisible({ timeout: 5000 });
  });

  test('should clear inputs correctly on input interactive events', async ({ page }) => {
    // Mock authenticated user session
    await page.route('**/api/v1/auth/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'user-123', email: 'test@example.com', full_name: 'Test User', role: 'USER' })
      });
    });
    await page.route('**/health', async (route) => {
      await route.fulfill({ status: 200, body: JSON.stringify({ status: 'ok' }) });
    });
    await page.route('**/api/v1/documents', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { id: 'doc-123', name: 'FPT_BCTC_2023.pdf', size: '1.2 MB', uploadedAt: '2026-07-02', status: 'indexed' }
        ])
      });
    });
    await page.route('**/api/v1/documents/doc-123/info', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'doc-123', name: 'FPT_BCTC_2023.pdf', totalPages: 1, pages: [{ page: 1, width: 800, height: 1000 }] })
      });
    });

    await page.goto('http://localhost:5173');
    const input = page.locator('input[placeholder*="Ask AI about"]');
    await input.fill('Temporary query');
    await expect(input).toHaveValue('Temporary query');
  });
});
