// Full-loop test for the redesigned UI. Exercises every preserved capability
// against the running server on :3000.
const { test, expect } = require('@playwright/test');
const { installRestore } = require('./_restore');

installRestore(test); // restore data/resume.json after these destructive tests

test.describe('redesigned resume tailor', () => {
  test('layout, preview, editor, autosave, theme, zoom all work', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    await page.goto('/');

    // core panes present
    await expect(page.locator('.topbar .brand-name')).toHaveText('Resume Tailor');
    await expect(page.locator('.jd-panel')).toBeVisible();
    await expect(page.locator('#editor .card')).toHaveCount(7);
    await expect(page.locator('.col-right #preview')).toBeVisible();

    // preview renders real content into the iframe
    const frame = page.frameLocator('#preview');
    await expect(frame.locator('body')).toContainText('KRISHNA SANAKA', { timeout: 15000 });

    // page badge resolves to a fit state (ok/scaled), not stuck loading.
    // First measurement includes Puppeteer cold-start on a fresh server, so allow room.
    await expect(page.locator('#pageBadge')).toHaveClass(/ok|scaled/, { timeout: 40000 });

    // save indicator starts saved
    await expect(page.locator('#saveIndicator')).toHaveClass(/saved/);

    // edit a summary -> dirty -> autosaves -> saved
    const summary = page.locator('textarea[data-path="summary"]');
    await summary.click();
    await summary.pressSequentially(' Reliable.');
    await expect(page.locator('#saveIndicator')).toHaveClass(/dirty/);
    await expect(page.locator('#saveIndicator')).toHaveClass(/saved/, { timeout: 8000 });
    await expect(page.locator('#saveText')).toContainText('Saved');

    // skill chip toggles hidden state
    const chip = page.locator('#skills .chip', { hasText: /^RxJS$/ }).first();
    await expect(chip).toBeVisible();
    await chip.click();
    await expect(chip).toHaveClass(/hidden/);
    await chip.click();
    await expect(chip).not.toHaveClass(/hidden/);

    // add + remove a bullet in first experience entry
    const expEntry = page.locator('#experience .entry').first();
    const before = await expEntry.locator('.bullet-row').count();
    await expEntry.getByRole('button', { name: '+ Add bullet' }).click();
    await expect(expEntry.locator('.bullet-row')).toHaveCount(before + 1);
    await expEntry.locator('.bullet-row .bullet-del').last().click();
    await expect(expEntry.locator('.bullet-row')).toHaveCount(before);

    // theme toggle flips data-theme
    const beforeTheme = await page.locator('html').getAttribute('data-theme');
    await page.locator('#themeBtn').click();
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', beforeTheme);

    // zoom 100% then fit
    await page.locator('#zoom100').click();
    await expect(page.locator('#zoom100')).toHaveClass(/is-active/);
    await page.locator('#zoomFit').click();
    await expect(page.locator('#zoomFit')).toHaveClass(/is-active/);

    // collapse a card
    const eduCard = page.locator('.card[data-section="education"]');
    await eduCard.locator('.card-head').click();
    await expect(eduCard).toHaveAttribute('open', '');

    expect(errors, 'no page errors').toEqual([]);
  });

  test('tailor -> word-level diff -> violations/hide-suggestions -> apply', async ({ page }) => {
    test.setTimeout(240000); // real AI latency varies (free tier can be 25-50s/call)
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const tailorResp = page.waitForResponse((r) => r.url().includes('/api/tailor') && r.request().method() === 'POST');

    await page.goto('/');
    await expect(page.frameLocator('#preview').locator('body')).toContainText('KRISHNA SANAKA', { timeout: 15000 });

    // paste a JD demanding off-topic tech (blockchain absent from a plain .NET role)
    await page.locator('#jd').fill(
      'Plain .NET Core backend developer for CRUD REST APIs over SQL Server with an Angular front-end. ' +
      'Standard business web app; no blockchain, no messaging. Skills: C#, .NET Core, SQL Server, Angular, REST APIs, Git.'
    );

    // Tailor via keyboard shortcut, verify loading state
    await page.locator('#tailorBtn').click();
    await expect(page.locator('#tailorBtn')).toHaveClass(/is-busy/);

    const resp = await tailorResp;
    expect(resp.status()).toBe(200);
    const data = await resp.json();

    // diff modal opens; usedModel surfaced
    await expect(page.locator('#diffModal')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#usedModel')).toContainText(/Answered by/i);

    // diff summary reflects counts
    await expect(page.locator('#diffSummary')).toContainText(/change/);

    // if AI suggested hides, the checklist shows and is checked
    if ((data.suggestedHidden || []).length) {
      await expect(page.locator('#hideSuggest')).toBeVisible();
      await expect(page.locator('#hideSuggest input[data-hide]').first()).toBeChecked();
    }

    // apply
    await page.locator('#diffApply').click();
    await expect(page.locator('#diffModal')).toBeHidden();
    await expect(page.locator('#toast')).toContainText(/applied/i);

    // preview updated & still fits
    await expect(page.locator('#pageBadge')).not.toHaveClass(/is-loading/, { timeout: 20000 });

    expect(errors, 'no page errors').toEqual([]);
  });

  test('export PDF triggers a download', async ({ page }) => {
    await page.goto('/');
    await expect(page.frameLocator('#preview').locator('body')).toContainText('KRISHNA SANAKA', { timeout: 15000 });
    const dl = page.waitForEvent('download');
    await page.locator('#pdfBtn').click();
    const download = await dl;
    expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  });
});
