import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function seek(page: Page, position: number) {
  const slider = page.getByRole('slider', { name: 'Replay position' });
  await slider.focus();
  await slider.press('Home');
  // Native setter gives the same input events as scrubbing, at an exact position.
  await slider.evaluate((input: HTMLInputElement, time) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, String(time));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, position);
  await expect(slider).toHaveValue(String(position));
}

async function expectNoPageOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

test('replay, evidence, shared segments and backward seeking stay synchronized', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?scenario=incident');
  await expect(page.getByRole('heading', { name: 'Internet Routing Monitor' })).toBeVisible();
  await expect(page.locator('.route-row')).toHaveCount(6);
  const positions = await page.locator('.observer-node').evaluateAll(nodes => nodes.map(node => node.getAttribute('transform')));
  await seek(page, 30);
  await expect(page.locator('.route-row').first()).toContainText('Withdrawn');
  await expect(page.locator('[data-shared-edge="64530:32934"]')).toHaveAttribute('data-support', '2');
  await page.locator('.route-row').first().click();
  const evidence = page.getByRole('dialog');
  await expect(evidence).toContainText('fixture-002');
  await expect(evidence).toContainText('15:38:30');
  await expect(evidence).toContainText('fixture:incident:30:2');
  await page.getByRole('button', { name: 'Close evidence' }).click();
  await seek(page, 12);
  await expect(page.locator('.route-row').first()).toContainText('Observed');
  expect(await page.locator('.observer-node').evaluateAll(nodes => nodes.map(node => node.getAttribute('transform')))).toEqual(positions);
  await seek(page, 30);
  await expect(page.locator('.route-row').first()).toContainText('Withdrawn');
  expect(errors).toEqual([]);
  await expectNoPageOverflow(page);
});

test('keyboard stepping, baseline comparison, isolation and zoom work', async ({ page }) => {
  await page.goto('/?scenario=incident');
  await page.getByRole('button', { name: 'Next event' }).click();
  await expect(page.getByRole('slider')).toHaveValue('20');
  await page.getByRole('button', { name: 'Previous event' }).click();
  await expect(page.getByRole('slider')).toHaveValue('0');
  await page.getByRole('button', { name: 'Compare baseline' }).click();
  await expect(page.locator('.comparison-path')).toHaveCount(6);
  await page.getByRole('button', { name: 'Inspect Amsterdam, Observed', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toContainText('Route evidence');
  await page.getByRole('button', { name: 'Isolate this observer' }).click();
  await expect(page.locator('.route-row')).toHaveCount(1);
  await page.getByRole('button', { name: 'Show all observers', exact: true }).click();
  await expect(page.locator('.route-row')).toHaveCount(6);
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Zoom level' })).toHaveText('125%');
  await page.getByRole('button', { name: 'Reset view' }).click();
  await expect(page.getByRole('status', { name: 'Zoom level' })).toHaveText('100%');
});

test('observer switching exposes unknown baselines and honors the six-path limit', async ({ page }) => {
  await page.goto('/?scenario=incident');
  await page.getByRole('button', { name: 'Choose observers' }).click();
  const choices = page.getByRole('checkbox');
  await expect(choices.nth(6)).toBeDisabled();
  await choices.nth(0).uncheck();
  await choices.nth(6).check();
  await expect(page.getByRole('dialog')).toContainText('6 of 6 selected');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('.route-row')).toHaveCount(6);
  const singapore = page.locator('.route-row').filter({ hasText: 'Singapore' });
  await expect(singapore).toContainText('Unknown baseline');
  await singapore.click();
  await expect(page.getByRole('dialog')).toContainText('Baseline not acquired');
  await page.keyboard.press('Escape');
  await expect(singapore).toBeFocused();
});

test('a source gap stays uncertain until new evidence after reconnect', async ({ page }) => {
  await page.goto('/?scenario=coverage&t=68');
  await expect(page.locator('.coverage-bar')).toContainText('1 observer uncertain');
  const stockholm = page.locator('.route-row').filter({ hasText: 'Stockholm' });
  await expect(stockholm).toContainText('Uncertain');
  await stockholm.click();
  await expect(page.getByRole('dialog')).toContainText('Reconnected; state still uncertain');
  await page.keyboard.press('Escape');
  await seek(page, 90);
  await expect(stockholm).toContainText('Observed');
});

test('play/pause works and simulated capture continues while presentation is paused', async ({ page }) => {
  await page.goto('/?scenario=incident');
  await page.getByRole('button', { name: 'Play replay', exact: true }).click();
  await expect(page.getByRole('slider')).not.toHaveValue('12');
  await page.getByRole('button', { name: 'Pause replay', exact: true }).click();
  await page.getByRole('button', { name: 'Live demo', exact: true }).click();
  await page.getByRole('button', { name: 'Pause presentation' }).click();
  const frozen = await page.getByRole('slider').inputValue();
  await page.waitForTimeout(2200);
  await expect(page.getByRole('slider')).toHaveValue(frozen);
  await page.getByRole('button', { name: 'Return to live demo' }).click();
  await expect(page.getByRole('slider')).not.toHaveValue(frozen);
});

test('desktop/mobile and a 200% desktop zoom viewport remain accessible with reduced motion', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?scenario=incident');
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(results.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target).join(', ')}`)).toEqual([]);
  await seek(page, 30);
  await expect(page.locator('[data-observer="demo-1"] .withdrawal-path')).toHaveCSS('opacity', '0');
  await expectNoPageOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('reduced-motion.png'), fullPage: true });
  // Browser zoom halves the CSS viewport; CSS zoom alone does not trigger breakpoints.
  if (testInfo.project.name.includes('desktop')) await page.setViewportSize({ width: 720, height: 500 });
  await expectNoPageOverflow(page);
  await page.getByRole('button', { name: 'Choose observers' }).click();
  const modalResults = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(modalResults.violations.map(v => v.id)).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath(testInfo.project.name.includes('desktop') ? 'zoom-200.png' : 'mobile-chooser.png'), fullPage: true });
});

test('loading, empty, stale and failure scenarios have readable recovery states', async ({ page }, testInfo) => {
  for (const [scenario, expected] of [['loading', 'Loading route snapshot'], ['empty', 'No observations for this interval'], ['error', 'The observation source is unavailable'], ['stale', 'Stale fixture']] as const) {
    await page.goto(`/?scenario=${scenario}`);
    await expect(page.getByRole('main')).toContainText(expected);
    if (scenario === 'loading' || scenario === 'error') {
      await expect(page.getByRole('main')).toContainText('0 displayed / 8 available');
      await expect(page.locator('.timeline-track rect')).toHaveCount(0);
    }
    await expectNoPageOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`${scenario}.png`), fullPage: true });
  }
  await page.goto('/?scenario=empty');
  await page.getByRole('button', { name: 'Open demo interval' }).click();
  await expect(page.locator('.route-row')).toHaveCount(6);
});

test('dense fixtures render only six paths and retain a bounded observer chooser', async ({ page }) => {
  await page.goto('/?scenario=dense');
  await expect(page.getByRole('main')).toContainText('6 displayed / 240 available');
  await expect(page.locator('.observer-node')).toHaveCount(6);
  await page.getByRole('button', { name: 'Next event' }).click();
  await expect(page.getByRole('slider')).toHaveValue('20');
  await page.getByRole('button', { name: 'Choose observers' }).click();
  await expect(page.getByRole('checkbox')).toHaveCount(12);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Page 2 / 20');
});

test('hidden tabs stop replay presentation and keyboard panning has a reset', async ({ page }) => {
  await page.goto('/?scenario=incident');
  const web = page.getByRole('group', { name: /Interactive route web/ });
  await web.focus();
  await web.press('ArrowRight');
  await expect(page.locator('.route-svg > g')).toHaveAttribute('transform', /translate\(-40,0\)/);
  await web.press('Home');
  await expect(page.locator('.route-svg > g')).toHaveAttribute('transform', /translate\(0,0\) scale\(1\)/);
  await page.getByRole('button', { name: 'Play replay', exact: true }).click();
  await expect(page.getByRole('slider')).not.toHaveValue('12');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(300);
  const held = await page.getByRole('slider').inputValue();
  await page.waitForTimeout(700);
  await expect(page.getByRole('slider')).toHaveValue(held);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByRole('slider')).not.toHaveValue(held);
});

test('historical entry shows actual routes, traceable evidence and reversible seeking', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('.freshness')).toContainText('RIPE RIS archive');
  await expect(page.locator('.route-row')).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Live demo', exact: true })).toBeDisabled();
  await expect(page.getByRole('slider')).toHaveValue('120');
  await expect(page.locator('.timeline-heading')).toContainText('15:37:00');
  await expect(page.locator('.timeline-labels span').last()).toBeVisible();
  await expect(page.locator('.timeline-labels span').last()).toContainText('21:30:00 UTC');
  const positions = await page.locator('[data-asn]').evaluateAll(nodes => nodes.map(n => [n.getAttribute('data-asn'), n.getAttribute('transform')]));
  await page.locator('.route-row').first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Reconstructed baseline');
  await expect(dialog).toContainText('Not recorded in MRT');
  await expect(dialog.locator('.evidence-record')).toContainText('bview.20211004.0800.gz');
  await expect(dialog.locator('.evidence-record')).toContainText('"sourceTime": "2021-10-04T08:00:00Z"');
  await expect(dialog.getByRole('link', { name: 'Open supporting MRT archive' })).toHaveAttribute('href', 'https://data.ris.ripe.net/rrc06/2021.10/bview.20211004.0800.gz');
  await page.keyboard.press('Escape');
  await seek(page, 900);
  await expect(page.locator('.route-row .route-status.withdrawn')).toHaveCount(3);
  await page.locator('.route-row').first().click();
  await expect(dialog).toContainText('2021-10-04T15:45:51Z');
  await expect(dialog.locator('.evidence-record')).toContainText('updates.20211004.1545.gz');
  await expect(dialog.locator('.evidence-record')).toContainText('"elem_type": "W"');
  await page.keyboard.press('Escape');
  await seek(page, 21300);
  await expect(page.locator('.route-row .route-status.observed')).toHaveCount(3);
  await seek(page, 120);
  await expect(page.locator('.route-row').first()).toContainText('AS2497 → AS32934');
  expect(await page.locator('[data-asn]').evaluateAll(nodes => nodes.map(n => [n.getAttribute('data-asn'), n.getAttribute('transform')]))).toEqual(positions);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(results.violations.map(v => v.id)).toEqual([]);
  await expectNoPageOverflow(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath('historical-replay.png'), fullPage: true });
  await page.getByRole('combobox', { name: 'Replay collection' }).click();
  await page.getByRole('option', { name: 'Facebook outage · synthetic replay', exact: true }).click();
  await expect(page.locator('.freshness')).toContainText('Synthetic data');
  await expect(page.getByRole('button', { name: 'Live demo', exact: true })).toBeEnabled();
  await expect(page.locator('.route-row')).toHaveCount(6);
  expect(errors).toEqual([]);
});
