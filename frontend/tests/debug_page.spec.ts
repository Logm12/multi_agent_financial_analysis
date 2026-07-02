/* eslint-disable */
import { test, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

test('Verification: UI/UX Audit on Chat Dashboard', async ({ page }) => {
  page.on('console', msg => console.log('BROWSER LOG:', msg.text()));
  page.on('pageerror', err => console.error('BROWSER ERROR:', err.message));

  const screenshotsDir = path.resolve('tests/screenshots/audit');
  const vnmPdf = path.resolve('../data/VNM_BCTC.pdf');

  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

  // 1. Navigate to register/login page
  console.log('[1] Navigating to login page...');
  await page.goto('http://localhost:5173/#/login');
  await page.waitForTimeout(2000);

  // Switch to Register Form
  const switchBtn = page.locator('button:has-text("Create one")');
  await switchBtn.waitFor({ state: 'visible', timeout: 5000 });
  await switchBtn.click();
  await page.waitForTimeout(1000);

  const email = `audit_${Date.now()}@lumo.ai`;
  console.log(`[2] Registering user: ${email}...`);
  await page.locator('#fullName').fill('UI/UX Audit Inspector');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill('Lumo@2024!');
  await page.getByRole('button', { name: 'Sign Up' }).click();
  
  // Wait for registration response to return and login form to display
  await page.waitForTimeout(3000);

  // If we are not auto-logged in, log in manually
  if (await page.locator('#email').isVisible()) {
    console.log('[3] Logging in manually...');
    await page.locator('#email').fill(email);
    await page.locator('#password').fill('Lumo@2024!');
    await page.getByRole('button', { name: 'Sign In' }).click();
  }

  // Wait for authentication and page redirect to complete by waiting for the sidebar
  console.log('[4] Waiting for sidebar to load...');
  try {
    await page.locator('aside').first().waitFor({ state: 'visible', timeout: 15000 });
  } catch (err) {
    console.error('Sidebar did not load! Capturing page HTML...');
    const html = await page.content();
    fs.writeFileSync(path.join(screenshotsDir, 'auth_fail_page.html'), html);
    await page.screenshot({ path: path.join(screenshotsDir, 'auth_fail.png'), fullPage: true });
    throw err;
  }

  console.log('[5] Verifying main chat dashboard in "No Document Selected" state...');
  try {
    // Let's print all inputs on the page to debug
    const inputs = await page.locator('input').evaluateAll((els: Element[]) =>
      els.map((el: any) => ({ id: el.id, type: el.type, placeholder: el.placeholder }))
    );
    console.log('Available inputs on dashboard:', JSON.stringify(inputs));

    const chatInput = page.locator('input[placeholder*="Ask AI about"]').or(page.locator('#chat-input-field'));
    await expect(chatInput.first()).toBeVisible({ timeout: 10000 });

    // ASSERTION 1: Bottom input bar is disabled
    await expect(chatInput.first()).toBeDisabled();
    // ASSERTION 2: Input placeholder shows select/upload guide
    const placeholder = await chatInput.first().getAttribute('placeholder');
    console.log('Chat input placeholder:', placeholder);
    expect(placeholder).toContain('Please upload or select');

    // ASSERTION 3: Right PDF viewer shows select/upload guide
    const rightPanel = page.locator('[data-testid="right-panel"]');
    await expect(rightPanel).toContainText('Please upload or select');

    // ASSERTION 4: LangGraph Active badge is visible
    const activeBadge = page.locator('text=LangGraph Active');
    await expect(activeBadge).toBeVisible();

    // Take initial state screenshot
    await page.screenshot({ path: path.join(screenshotsDir, '01_dashboard_no_pdf.png'), fullPage: true });

    // 5. Click on the "Upload Report" card to select and upload file
    console.log('[6] Uploading Vinamilk statement via file-upload...');
    await page.locator('#file-upload').evaluate((el: HTMLInputElement) => el.style.display = 'block');
    await page.locator('#file-upload').setInputFiles(vnmPdf);

    // Wait for upload processing completion
    console.log('[7] Waiting for upload processing to complete...');
    const uploadMsg = page.locator('text=Successfully processed').or(page.locator('text=existed in system')).first();
    await expect(uploadMsg).toBeVisible({ timeout: 90000 });

    // ASSERTION 5: Once loaded, bottom input bar is enabled
    console.log('[8] Verifying chat input is now active...');
    await expect(chatInput.first()).toBeEnabled();

    // Take loaded state screenshot
    await page.screenshot({ path: path.join(screenshotsDir, '02_dashboard_loaded_pdf.png'), fullPage: true });
    console.log('[9] UI/UX audit complete. Screenshots saved.');
  } catch (err) {
    const html = await page.content();
    fs.writeFileSync(path.join(screenshotsDir, 'dashboard_fail_page.html'), html);
    await page.screenshot({ path: path.join(screenshotsDir, 'dashboard_fail.png'), fullPage: true });
    throw err;
  }
});
