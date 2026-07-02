/* eslint-disable */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

test.describe('Multi-Agent E2E Financial Analysis Evaluation Suite', () => {
  // Increase timeout for long-running batch LLM queries to 20 minutes
  test.setTimeout(1200000);

  const datasetPath = path.resolve(process.cwd(), '../evaluation/test_dataset.json');
  const resultsOutputPath = path.resolve(process.cwd(), '../evaluation/browser_evaluation_results.json');
  
  test('Execute full 20-case evaluation against live system', async ({ page }) => {
    // 1. Load test cases
    expect(fs.existsSync(datasetPath)).toBe(true);
    const testCases = JSON.parse(fs.readFileSync(datasetPath, 'utf-8')).slice(0, 20);
    console.log(`Loaded ${testCases.length} test cases (capped at 20 for UI validation stability).`);

    // 2. Navigate to frontend dev server
    await page.goto('http://localhost:5173');
    await page.waitForLoadState('networkidle');
    console.log('Successfully navigated to http://localhost:5173');

    // Register and login to start an authenticated session on the live system
    await page.goto('http://localhost:5173/#/login');
    const switchBtn = page.locator('button:has-text("Create one")');
    await switchBtn.waitFor({ state: 'visible', timeout: 5000 });
    await switchBtn.click();
    const email = `eval_${Date.now()}@lumo.ai`;
    await page.locator('#fullName').fill('Evaluation User');
    await page.locator('#email').fill(email);
    await page.locator('#password').fill('Lumo@2024!');
    await page.getByRole('button', { name: 'Sign Up' }).click();
    await page.waitForTimeout(2000);

    // Manual login since registration redirects to login page
    if (await page.locator('#email').isVisible()) {
      console.log('Logging in with registered evaluation credentials...');
      await page.locator('#email').fill(email);
      await page.locator('#password').fill('Lumo@2024!');
      await page.getByRole('button', { name: 'Sign In' }).click();
    }
    
    // Wait for auth to complete and transition to the dashboard
    await page.locator('input[placeholder*="Ask AI about"]').waitFor({ state: 'visible', timeout: 15000 });

    // 3. Ingestion of PDFs (both Digital and Scanned)
    const pdfsToUpload = [
      path.resolve(process.cwd(), '../data/test_pdfs/FPT_BCTC.pdf'),
      path.resolve(process.cwd(), '../data/test_pdfs/VNM_BCTC.pdf'),
      path.resolve(process.cwd(), '../data/test_pdfs_scanned/VNM_Q3-2025_4.pdf')
    ];

    let uploadCount = 0;
    for (const pdfPath of pdfsToUpload) {
      if (fs.existsSync(pdfPath)) {
        console.log(`Uploading document: ${path.basename(pdfPath)}...`);
        uploadCount++;
        
        // Make input visible and set files
        await page.locator('#file-upload').evaluate((el: HTMLInputElement) => el.style.display = 'block');
        await page.locator('#file-upload').setInputFiles(pdfPath);
        
        // Wait for processing status bubble to transition into completed/failed/error status
        await expect(
          page.locator('div:has-text("processed"), div:has-text("existed"), div:has-text("thành công"), div:has-text("thất bại"), div:has-text("Error"), div:has-text("Lỗi")').nth(uploadCount - 1)
        ).toBeVisible({ timeout: 180000 });
        
        console.log(`Uploaded and processed: ${path.basename(pdfPath)}`);
        
        // Clear chat or wait a bit
        await page.waitForTimeout(2000);
      } else {
        console.warn(`File not found, skipping upload: ${pdfPath}`);
      }
    }

    const evaluationResults = [];

    // 4. Sequentially process all 20 questions
    for (let i = 0; i < testCases.length; i++) {
      const tc = testCases[i];
      console.log(`\n[${i+1}/${testCases.length}] Running ${tc.id}: "${tc.question}"`);

      const startTime = Date.now();

      // Enter question in chat
      const input = page.locator('input[placeholder*="Ask AI about"]');
      await input.fill(tc.question);
      await input.press('Enter');

      // Wait for the send button spinner to disappear and the Send icon to reappear.
      // Allow up to 240 seconds for complex multi-agent reasoning steps.
      await page.locator('button:has(svg.lucide-send)').waitFor({ state: 'visible', timeout: 240000 });

      const latency = (Date.now() - startTime) / 1000;
      console.log(`    -> Done in ${latency.toFixed(2)}s`);

      // Extract the last AI response bubble
      const bubbles = page.locator('.flex-row >> div.rounded-2xl');
      const lastBubble = bubbles.last();
      const answerText = await lastBubble.textContent() || '';
      
      // Check if a chart image is present in the UI
      const chartImage = page.locator('img[alt*="AI Generated Chart Analysis"]').last();
      const hasChart = await chartImage.isVisible().catch(() => false);
      const chartUrl = hasChart ? await chartImage.getAttribute('src') : null;

      // Check if table is present
      const hasTable = await page.locator('#financial-data-table').last().isVisible().catch(() => false);

      // Check for reasoning steps
      const reasoningDetails = page.locator('#reasoning-steps').last();
      const hasSteps = await reasoningDetails.isVisible().catch(() => false);
      const steps = [];
      if (hasSteps) {
        const stepItems = page.locator('#reasoning-steps >> span');
        const count = await stepItems.count();
        for (let j = 0; j < count; j++) {
          const stepText = await stepItems.nth(j).textContent();
          if (stepText) steps.push(stepText.trim());
        }
      }

      console.log(`    -> Has Chart: ${hasChart} | Has Table: ${hasTable}`);
      console.log(`    -> Answer excerpt: ${answerText.substring(0, 100).replace(/\n/g, ' ')}...`);

      evaluationResults.push({
        id: tc.id,
        category: tc.category,
        question: tc.question,
        ground_truth: tc.ground_truth,
        answer: answerText.trim(),
        latency: latency,
        has_chart: hasChart,
        chart_url: chartUrl,
        has_table: hasTable,
        steps: steps
      });

      // Clear chat or wait before next question
      await page.waitForTimeout(2000);
    }

    // 5. Write the browser evaluation results to file
    fs.writeFileSync(resultsOutputPath, JSON.stringify(evaluationResults, null, 2), 'utf-8');
    console.log(`Successfully saved evaluation results to ${resultsOutputPath}`);
  });
});
