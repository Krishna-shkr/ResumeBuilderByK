// Verifies the "hide off-topic technology" feature:
//   1. Manual: clicking a skill chip hides that tech from the live preview
//      (Skills section only) and is reversible.
//   2. AI-assisted: tailoring to an off-topic JD surfaces a hide-suggestions
//      checklist in the diff modal; approving it hides the checked tech.
const { test, expect } = require('@playwright/test');
const { installRestore } = require('./_restore');

installRestore(test); // restore data/resume.json after these destructive tests

test('manual chip toggle hides a skill from the preview and is reversible', async ({ page }) => {
  await page.goto('/');
  // RxJS lives only in the Skills section (not in any bullet/stack), so hiding it
  // must make it disappear from the preview entirely.
  const chip = page.locator('#skills .chip', { hasText: /^RxJS$/ }).first();
  await expect(chip).toBeVisible({ timeout: 15000 });

  const previewBody = () => page.frameLocator('#preview').locator('body');
  await expect(previewBody()).toContainText('RxJS', { timeout: 15000 });

  await chip.click(); // hide
  await expect(chip).toHaveClass(/hidden/);
  await expect
    .poll(async () => (await previewBody().innerText()).includes('RxJS'), { timeout: 15000 })
    .toBe(false);

  await chip.click(); // show again — reversible
  await expect(chip).not.toHaveClass(/hidden/);
  await expect(previewBody()).toContainText('RxJS', { timeout: 15000 });
});

test('AI suggests off-topic tech to hide; approving hides it', async ({ page }) => {
  test.setTimeout(150000); // real Gemini call can be slow
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const tailorResponse = page.waitForResponse(
    (r) => r.url().includes('/api/tailor') && r.request().method() === 'POST'
  );
  await page.goto('/');
  await expect(page.locator('#skills .chip').first()).toBeVisible({ timeout: 15000 });

  await page.fill(
    '#jd',
    'Plain .NET Core backend developer for CRUD REST APIs over SQL Server with an Angular front-end. Standard business web app; no blockchain, no messaging, no realtime. Skills: C#, .NET Core, SQL Server, Angular, REST APIs, Git.'
  );
  await page.click('#tailorBtn');

  const resp = await tailorResponse;
  expect(resp.status()).toBe(200);
  const data = await resp.json();
  expect(Array.isArray(data.suggestedHidden)).toBe(true);
  expect(data.suggestedHidden.length, 'AI should flag some off-topic tech').toBeGreaterThan(0);

  // no client-side error broke the modal
  expect(errors, 'no page errors').toEqual([]);

  // hide-suggestions checklist appears in the modal, checked by default
  const suggest = page.locator('#hideSuggest');
  await expect(suggest).toBeVisible({ timeout: 15000 });
  const boxes = suggest.locator('input[data-hide]');
  expect(await boxes.count()).toBeGreaterThan(0);

  // pick the first suggested token; ensure it's checked, then apply
  const firstTok = await boxes.first().getAttribute('data-hide');
  await expect(boxes.first()).toBeChecked();

  await page.click('#diffApply');
  await expect(page.locator('#diffModal')).toBeHidden();

  // the approved token should now be a hidden chip and gone from the preview's skills
  const hiddenChip = page.locator('#skills .chip.hidden', { hasText: new RegExp('^' + firstTok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') });
  await expect(hiddenChip).toBeVisible({ timeout: 15000 });
});
