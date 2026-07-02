/* eslint-disable */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

test.describe('Async PDF Upload & Coder Agent Chart Plotting E2E Tests (TIP-002 & TIP-005)', () => {
  const assetsDir = path.resolve('tests/assets');
  const dummyPdf = path.join(assetsDir, 'test_dummy.pdf');

  test.beforeAll(() => {
    if (!fs.existsSync(assetsDir)) {
      fs.mkdirSync(assetsDir, { recursive: true });
    }
    fs.writeFileSync(dummyPdf, '%PDF-1.4 dummy content');
  });

  test.afterAll(() => {
    try {
      if (fs.existsSync(dummyPdf)) fs.unlinkSync(dummyPdf);
      if (fs.existsSync(assetsDir)) fs.rmdirSync(assetsDir);
    } catch (e) {
      console.error('Cleanup error:', e);
    }
  });

  test.beforeEach(async ({ page }) => {
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
  });

  test('Scenario 1: Standard digital PDF upload, status polling transitions (pending -> processing -> completed)', async ({ page }) => {
    await page.goto('http://localhost:5173');

    // Mock upload API
    await page.route('**/upload-pdf', async (route) => {
      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'success', task_id: 'task-digital-123' })
      });
    });

    // Mock status polling with transitions
    let pollCount = 0;
    await page.route('**/status/task-digital-123', async (route) => {
      pollCount++;
      let responseBody = {};
      if (pollCount === 1) {
        responseBody = { status: 'pending', details: 'Extracting text from PDF...' };
      } else if (pollCount === 2) {
        responseBody = { status: 'processing', details: 'Cleaning extracted text...' };
      } else {
        responseBody = { status: 'completed', details: 'Successfully processed 12 chunks.' };
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(responseBody)
      });
    });

    // Handle file input
    await page.locator('#file-upload').evaluate((el: HTMLInputElement) => el.style.display = 'block');
    await page.locator('#file-upload').setInputFiles(dummyPdf);

    // Verify initial uploading toast
    const loadingBubble = page.locator('text=Analyzing document:');
    await expect(loadingBubble).toBeVisible({ timeout: 5000 });

    // Verify transitions and final completion bubble text
    const completedBubble = page.locator('text=Successfully processed 12 chunks.');
    await expect(completedBubble).toBeVisible({ timeout: 10000 });
  });

  test('Scenario 2: Scanned PDF upload triggering EasyOCR fallback status polling', async ({ page }) => {
    await page.goto('http://localhost:5173');

    // Mock upload API
    await page.route('**/upload-pdf', async (route) => {
      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'success', task_id: 'task-scanned-123' })
      });
    });

    // Mock status polling for scanned document
    let pollCount = 0;
    await page.route('**/status/task-scanned-123', async (route) => {
      pollCount++;
      let responseBody = {};
      if (pollCount === 1) {
        responseBody = { status: 'pending', details: 'Extracting text from PDF...' };
      } else if (pollCount === 2) {
        responseBody = { status: 'processing', details: 'Running EasyOCR parser fallback...' };
      } else {
        responseBody = { status: 'completed', details: 'Successfully processed 8 OCR fallback chunks.' };
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(responseBody)
      });
    });

    // Handle file input
    await page.locator('#file-upload').evaluate((el: HTMLInputElement) => el.style.display = 'block');
    await page.locator('#file-upload').setInputFiles(dummyPdf);

    // Verify final OCR success message is visible
    const completedBubble = page.locator('text=Successfully processed 8 OCR fallback chunks.');
    await expect(completedBubble).toBeVisible({ timeout: 10000 });
  });

  test('Scenario 3: Upload deduplication returning immediate indexing success', async ({ page }) => {
    await page.goto('http://localhost:5173');

    // Mock upload API to return 'existing' status instantly
    await page.route('**/upload-pdf', async (route) => {
      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({ task_id: 'existing', message: 'File already processed' })
      });
    });

    // Mock status polling for immediate completed state
    await page.route('**/status/existing', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'completed', details: 'File already existed. Skipping parsing.' })
      });
    });

    // Handle file input
    await page.locator('#file-upload').evaluate((el: HTMLInputElement) => el.style.display = 'block');
    await page.locator('#file-upload').setInputFiles(dummyPdf);

    // Verify it transitions and displays completion message immediately
    const completedBubble = page.locator('text=File already existed. Skipping parsing.');
    await expect(completedBubble).toBeVisible({ timeout: 5000 });
  });

  test('Scenario 4: Coder Agent chart plotting rendering base64 matplotlib plots', async ({ page }) => {
    // Mock the chart image request to prevent onError being triggered
    await page.route('**/api/v1/sandbox/charts/chart_plot.png', async (route) => {
      const pixelBuffer = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
        'base64'
      );
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: pixelBuffer
      });
    });

    await page.goto('http://localhost:5173');

    // Mock SSE chat streaming API
    await page.route('**/chat-stream*', async (route) => {
      const sseBody = [
        'event: step\n',
        'data: {"output": "Phân tích yêu cầu vẽ biểu đồ..."}\n\n',
        'event: step\n',
        'data: {"output": "Khởi chạy Sandbox Docker python..."}\n\n',
        'event: final_answer\n',
        'data: {"content": "Dưới đây là biểu đồ phân tích doanh thu.", "chart_url": "/api/v1/sandbox/charts/chart_plot.png"}\n\n',
        'event: done\n',
        'data: {}\n\n'
      ].join('');

      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: sseBody
      });
    });

    // Input prompt and click Send
    await page.locator('input[placeholder*="Ask AI about"]').fill('Vẽ biểu đồ doanh thu Vinamilk');
    await page.locator('button:has(svg.lucide-send)').click();

    // Verify reasoning steps detail is populated
    const reasoning = page.locator('#reasoning-steps');
    await expect(reasoning).toBeVisible({ timeout: 5000 });
    await expect(reasoning).toContainText('Thought process');
    await expect(reasoning).toContainText('Phân tích yêu cầu vẽ biểu đồ...');
    await expect(reasoning).toContainText('Khởi chạy Sandbox Docker python...');

    // Verify main final answer text is visible
    const finalAnswer = page.locator('text=Dưới đây là biểu đồ phân tích doanh thu.');
    await expect(finalAnswer).toBeVisible({ timeout: 5000 });

    // Verify Coder Agent Chart Image is rendered with the correct src attribute
    const chartImg = page.locator('img[alt="AI Generated Chart Analysis"]');
    await expect(chartImg).toBeVisible({ timeout: 5000 });
    const imgSrc = await chartImg.getAttribute('src');
    expect(imgSrc).toContain('/api/v1/sandbox/charts/chart_plot.png');
  });
});
