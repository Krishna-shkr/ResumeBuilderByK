// Verifies the 2-page lock: the badge reflects fit, and overflow content
// triggers the warning (auto-fit tried first, never silently spilling).
const { test, expect } = require('@playwright/test');
const { installRestore } = require('./_restore');

installRestore(test); // restore data/resume.json after these destructive tests

test('current resume shows a green fit badge, no overflow warning', async ({ page }) => {
  await page.goto('/');
  const badge = page.locator('#pageBadge');
  await expect(badge).toHaveClass(/ok|scaled/, { timeout: 40000 });
  await expect(badge.locator('.page-badge-text')).toContainText(/pages/);
  await expect(page.locator('#overflowWarn')).toBeHidden();
});

test('bloated content trips the overflow warning with a trim suggestion', async ({ page }) => {
  test.setTimeout(90000);
  await page.goto('/');
  await expect(page.locator('#pageBadge')).toHaveClass(/ok|scaled/, { timeout: 40000 });

  // Fill EVERY editable bullet (experience + projects) with a large paragraph to
  // force > 2 pages even after the auto-fit shrinks to minimum scale.
  const huge = ('Delivered large-scale full-stack features across the stack. ').repeat(90);
  const bullets = page.locator('#experience .bullet-row textarea, #projects .bullet-row textarea');
  const count = await bullets.count();
  for (let i = 0; i < count; i++) await bullets.nth(i).fill(huge);

  const badge = page.locator('#pageBadge');
  await expect(badge).toHaveClass(/over/, { timeout: 40000 });
  await expect(badge.locator('.page-badge-text')).toContainText(/Over 2 pages/);

  const warn = page.locator('#overflowWarn');
  await expect(warn).toBeVisible();
  // names a specific section to trim as a clickable link
  await expect(warn).toContainText(/Trim:/);
  await expect(warn.locator('.trim-link')).toContainText(/Experience #\d|Project "|Professional Summary/i);

  // clicking the trim link scrolls to + flashes the relevant editor card
  await warn.locator('.trim-link').click();
  await expect(page.locator('.card.flash')).toHaveCount(1);
});
