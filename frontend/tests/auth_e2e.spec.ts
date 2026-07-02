/* eslint-disable */
import { test, expect } from '@playwright/test';

/**
 * TIP-AUTH-003 E2E Tests: Authentication UI and Session Management
 *
 * Covers:
 *  1. Login form renders when unauthenticated
 *  2. Tab switch to Register form (Full Name visible)
 *  3. Error on invalid credentials
 *  4. Rate-limit error message
 *  5. Empty field client-side validation
 *  6. Successful login → sidebar with user profile
 *  7. Already-authenticated redirect (no login form shown)
 *  8. Logout → back to login form
 *  9. Non-admin blocked from /admin
 * 10. Admin user can access /admin dashboard
 * 11. Multi-tab logout guard (localStorage storage event)
 */

const MOCK_ADMIN_USER = {
  id: 'user-e2e-admin-001',
  email: 'giamkhao@lumo.ai',
  full_name: 'Giam Khao Lumo',
  role: 'ADMIN',
};

const MOCK_REGULAR_USER = {
  id: 'user-e2e-user-001',
  email: 'student@lumo.ai',
  full_name: 'Test Student',
  role: 'USER',
};

// ─── Helpers ─────────────────────────────────────────────────────────────
async function mockUnauthenticated(page: any) {
  await page.route('**/api/v1/auth/me', (route: any) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ detail: 'Not authenticated' }),
    })
  );
}

async function mockAuthenticated(page: any, user = MOCK_ADMIN_USER) {
  await page.route('**/api/v1/auth/me', (route: any) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(user) })
  );
  await page.route('**/health', (route: any) =>
    route.fulfill({ status: 200, body: JSON.stringify({ status: 'ok' }) })
  );
}

test.beforeEach(({ page }) => {
  page.on('console', msg => console.log(`[AUTH BROWSER CONSOLE ${msg.type()}]:`, msg.text()));
  page.on('pageerror', err => console.error('[AUTH BROWSER PAGE ERROR]:', err));
});

// ─── 1. Form Rendering ────────────────────────────────────────────────────
test.describe('1. Auth: Login Form Rendering', () => {
  test('should render login form with email/password inputs', async ({ page }) => {
    await mockUnauthenticated(page);
    await page.goto('/#/login');

    await expect(page.getByRole('heading', { name: /Welcome Back/i })).toBeVisible({ timeout: 8000 });
    await expect(page.locator('#email')).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();

    await page.screenshot({ path: 'tests/screenshots/01_login_form.png', fullPage: true });
  });

  test('should switch to Register form via "Create one" button', async ({ page }) => {
    await mockUnauthenticated(page);
    await page.goto('/#/login');

    await page.getByRole('button', { name: 'Create one' }).click();

    await expect(page.getByRole('heading', { name: /Create Account/i })).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#fullName')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign Up' })).toBeVisible();

    await page.screenshot({ path: 'tests/screenshots/02_register_form.png', fullPage: true });
  });
});

// ─── 2. Error Handling ────────────────────────────────────────────────────
test.describe('2. Auth: Login Error Handling', () => {
  test('should display error message on invalid credentials (401)', async ({ page }) => {
    await mockUnauthenticated(page);

    await page.route('**/api/v1/auth/login', (route: any) =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Incorrect email or password.' }),
      })
    );

    await page.goto('/#/login');
    await page.locator('#email').fill('wrong@example.com');
    await page.locator('#password').fill('wrongpass');

    const loginResponsePromise = page.waitForResponse(
      (resp: any) => resp.url().includes('/api/v1/auth/login')
    );
    await page.getByRole('button', { name: 'Sign In' }).click();
    await loginResponsePromise;

    // Wait for React to re-render with the error message
    await page.waitForFunction(
      () => document.body.innerText.includes('Incorrect email or password'),
      { timeout: 5000 }
    );
    await page.screenshot({ path: 'tests/screenshots/03_login_error.png', fullPage: true });
  });

  test('should display rate limit error (429)', async ({ page }) => {
    await mockUnauthenticated(page);

    await page.route('**/api/v1/auth/login', (route: any) =>
      route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Rate limit exceeded. Please wait 60 seconds.' }),
      })
    );

    await page.goto('/#/login');
    await page.locator('#email').fill('test@lumo.ai');
    await page.locator('#password').fill('password123');

    const loginResponsePromise = page.waitForResponse(
      (resp: any) => resp.url().includes('/api/v1/auth/login')
    );
    await page.getByRole('button', { name: 'Sign In' }).click();
    await loginResponsePromise;

    // Wait for React to re-render with the error message
    await page.waitForFunction(
      () => document.body.innerText.includes('Rate limit exceeded'),
      { timeout: 5000 }
    );
    await page.screenshot({ path: 'tests/screenshots/04_rate_limit.png', fullPage: true });
  });

  test('should show client-side validation for empty fields', async ({ page }) => {
    await mockUnauthenticated(page);
    await page.goto('/#/login');

    // Click submit with nothing filled
    await page.getByRole('button', { name: 'Sign In' }).click();

    await expect(page.locator('text=Please fill in all fields.')).toBeVisible({ timeout: 3000 });
    await page.screenshot({ path: 'tests/screenshots/05_empty_validation.png', fullPage: true });
  });
});

// ─── 3. Successful Login ──────────────────────────────────────────────────
test.describe('3. Auth: Successful Login Flow', () => {
  test('should login successfully and show sidebar with user profile', async ({ page }) => {
    // Step 1: /me returns 401 initially
    // Step 2: login returns 200 with user data
    // Step 3: React checkAuth again which calls /me — mock it authenticated after login

    let authenticated = false;

    await page.route('**/api/v1/auth/me', (route: any) => {
      if (authenticated) {
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_ADMIN_USER) });
      } else {
        route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ detail: 'Not authenticated' }) });
      }
    });

    await page.route('**/api/v1/auth/login', (route: any) => {
      authenticated = true; // flip state after login
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'success', message: 'Logged in successfully.', user: MOCK_ADMIN_USER }),
      });
    });

    await page.route('**/health', (route: any) =>
      route.fulfill({ status: 200, body: JSON.stringify({ status: 'ok' }) })
    );

    await page.goto('/#/login');

    // Login form should be showing
    await expect(page.getByRole('heading', { name: /Welcome Back/i })).toBeVisible({ timeout: 5000 });

    // Fill form
    await page.locator('#email').fill('giamkhao@lumo.ai');
    await page.locator('#password').fill('Lumo@2024!');

    const loginResponse = page.waitForResponse(
      (resp: any) => resp.url().includes('/api/v1/auth/login')
    );
    await page.getByRole('button', { name: 'Sign In' }).click();
    await loginResponse;

    // Wait for sidebar to appear
    await expect(page.locator('aside').first()).toBeVisible({ timeout: 10000 });

    // Sidebar should contain the user's nickname (last part of full_name)
    // MOCK_ADMIN_USER.full_name = 'Giam Khao Lumo' → nickname = 'Lumo'
    const sidebarNickname = page.locator('aside').getByText('Lumo').first();
    await expect(sidebarNickname).toBeVisible({ timeout: 5000 });

    await page.screenshot({ path: 'tests/screenshots/06_login_success.png', fullPage: true });
  });

  test('should skip login form when already authenticated', async ({ page }) => {
    await mockAuthenticated(page);
    await page.goto('/');

    // Sidebar should appear without login form
    await expect(page.locator('aside').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#email')).not.toBeVisible();

    await page.screenshot({ path: 'tests/screenshots/07_already_auth.png', fullPage: true });
  });
});

// ─── 4. Logout ────────────────────────────────────────────────────────────
test.describe('4. Auth: Logout Flow', () => {
  test('should logout and return to login form', async ({ page }) => {
    await mockAuthenticated(page);

    await page.route('**/api/v1/auth/logout', (route: any) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'success', message: 'Logged out successfully.' }),
      })
    );

    await page.goto('/');
    await expect(page.locator('aside').first()).toBeVisible({ timeout: 10000 });

    // Click logout button - it has title="Log Out"
    const logoutBtn = page.locator('aside button[title="Log Out"]');
    await expect(logoutBtn).toBeVisible({ timeout: 5000 });
    await logoutBtn.click();

    // After logout: login form should reappear
    await expect(page.locator('#email')).toBeVisible({ timeout: 8000 });
    await page.screenshot({ path: 'tests/screenshots/08_logout.png', fullPage: true });
  });
});

// ─── 5. Admin Route Protection ────────────────────────────────────────────
test.describe('5. Auth: Admin Route Protection', () => {
  test('should block non-admin from accessing /admin', async ({ page }) => {
    await mockAuthenticated(page, MOCK_REGULAR_USER);

    // Use hash URL for HashRouter — /admin is /#/admin
    await page.goto('/#/admin');

    // Admin heading must not be visible
    await expect(page.getByRole('heading', { name: /admin dashboard/i })).not.toBeVisible({ timeout: 5000 });
    // Should have been redirected to home (Chat page)
    await expect(page.locator('aside').first()).toBeVisible({ timeout: 5000 });

    await page.screenshot({ path: 'tests/screenshots/09_admin_blocked.png', fullPage: true });
  });

  test('should allow ADMIN user to access /admin with full dashboard', async ({ page }) => {
    await mockAuthenticated(page, MOCK_ADMIN_USER);

    await page.route('**/api/v1/auth/admin/stats', (route: any) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'success',
          stats: { total_users: 3, total_documents: 12, total_storage_bytes: 10485760 },
          users: [
            { id: '1', email: 'giamkhao@lumo.ai', full_name: 'Giam Khao', role: 'ADMIN', created_at: '2024-01-01T00:00:00' },
            { id: '2', email: 'student@lumo.ai', full_name: 'Test Student', role: 'USER', created_at: '2024-01-02T00:00:00' },
          ],
          documents: [
            { id: 'doc-1', filename: 'FPT_Q4_2023.pdf', size_bytes: 5242880, uploaded_at: '2024-01-10T00:00:00', owner_email: 'giamkhao@lumo.ai' },
          ],
          token_usage: [
            { date: '2026-05-14', prompt_tokens: 124000, completion_tokens: 45000 },
            { date: '2026-05-15', prompt_tokens: 145000, completion_tokens: 52000 },
            { date: '2026-05-16', prompt_tokens: 198000, completion_tokens: 78000 },
            { date: '2026-05-17', prompt_tokens: 160000, completion_tokens: 61000 },
            { date: '2026-05-18', prompt_tokens: 210000, completion_tokens: 85000 },
            { date: '2026-05-19', prompt_tokens: 250000, completion_tokens: 98000 },
            { date: '2026-05-20', prompt_tokens: 285000, completion_tokens: 112000 },
          ],
        }),
      })
    );

    // Wait for admin stats request to complete (setup promise before navigation)
    const statsResponsePromise = page.waitForResponse(
      (resp: any) => resp.url().includes('/api/v1/auth/admin/stats'),
      { timeout: 10000 }
    );

    // Use hash URL for HashRouter — /admin is /#/admin
    await page.goto('/#/admin');
    await statsResponsePromise;

    // Header visible
    await expect(page.getByRole('heading', { name: /admin dashboard/i })).toBeVisible({ timeout: 8000 });

    // Stats cards visible
    await expect(page.getByText('Total Accounts')).toBeVisible();
    await expect(page.getByText('Documents Stored')).toBeVisible();
    await expect(page.getByText('Storage Consumed')).toBeVisible();

    // User and document data visible
    await expect(page.getByText('Giam Khao')).toBeVisible();
    await expect(page.getByText('FPT_Q4_2023.pdf')).toBeVisible();

    // Token chart section visible
    await expect(page.getByText('Local LLM Token Consumption')).toBeVisible();

    await page.screenshot({ path: 'tests/screenshots/10_admin_dashboard.png', fullPage: true });
  });
});

// ─── 6. Multi-Tab Logout Guard ────────────────────────────────────────────
test.describe('6. Auth: Multi-Tab Logout Guard', () => {
  test('should react to logout-event from another tab via localStorage', async ({ page }) => {
    await mockAuthenticated(page, MOCK_ADMIN_USER);

    await page.goto('/');
    await expect(page.locator('aside').first()).toBeVisible({ timeout: 10000 });

    // Simulate another browser tab firing the logout event
    await page.evaluate(() => {
      const ts = Date.now().toString();
      localStorage.setItem('logout-event', ts);
      // Manually dispatch storage event (same window dispatch for test)
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'logout-event',
          newValue: ts,
          storageArea: localStorage,
        })
      );
    });

    // App should react: either show a modal or redirect to login
    // The modal or #email input should become visible
    const reacted = page.locator('#email').or(
      page.getByText(/logged out|phiên đăng nhập|session expired/i)
    );
    await expect(reacted.first()).toBeVisible({ timeout: 8000 });
    await page.screenshot({ path: 'tests/screenshots/11_multitab_logout.png', fullPage: true });
  });
});
