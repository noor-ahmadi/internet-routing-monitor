import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function seek(page: Page, position: number) {
  const slider = page.getByRole('slider', { name: 'Replay position' });
  await slider.focus();
  await slider.evaluate((input: HTMLInputElement, time) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, String(time));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, position);
  await expect(slider).toHaveValue(String(position));
}
async function openPaths(page: Page) {
  await page.getByRole('button', { name: /Observers \d/ }).click();
  await expect(page.getByRole('dialog', { name: 'Explore' })).toBeVisible();
}
async function closeExplorer(page: Page) {
  await page.getByRole('button', { name: 'Close explorer' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
async function closeEvidence(page: Page) {
  await page.getByRole('button', { name: 'Close evidence' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
async function expectNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}
async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .options({ rules: { 'label-content-name-mismatch': { enabled: true } } }).analyze();
  expect(results.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target).join(', ')}`)).toEqual([]);
}

test('replay, evidence and shared segments stay synchronized without moving observers', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?scenario=incident');
  await expect(page.getByRole('heading', { name: 'Internet Routing Monitor' })).toBeVisible();
  await expect(page.locator('.route-row')).toHaveCount(0);
  const positions = await page.locator('.observer-node').evaluateAll(nodes => nodes.map(n => n.getAttribute('transform')));
  await seek(page, 30);
  await expect(page.locator('[data-shared-edge="64530:32934"]')).toHaveAttribute('data-support', '2');
  await page.getByRole('button', { name: /^Inspect Amsterdam AS.*Withdrawn$/ }).click();
  const evidence = page.getByRole('dialog', { name: 'Route evidence' });
  await evidence.getByText('Supporting fixture record', { exact: true }).click();
  await expect(evidence).toContainText('fixture-002');
  await expect(evidence).toContainText('15:38:30');
  await expect(evidence).toContainText('fixture:incident:30:2');
  await closeEvidence(page);
  await seek(page, 12);
  await openPaths(page);
  await expect(page.locator('.route-row')).toHaveCount(6);
  await expect(page.locator('.route-row').first()).toContainText('Observed');
  await closeExplorer(page);
  expect(await page.locator('.observer-node').evaluateAll(nodes => nodes.map(n => n.getAttribute('transform')))).toEqual(positions);
  await seek(page, 30);
  await expect(page.locator('[data-observer="demo-1"] .node-dot')).toHaveClass(/withdrawn/);
  expect(errors).toEqual([]);
  await expectNoOverflow(page);
});

test('keyboard stepping, comparison, isolation and zoom work', async ({ page }) => {
  await page.goto('/?scenario=incident');
  await page.getByRole('button', { name: 'Next event' }).click();
  await expect(page.getByRole('slider')).toHaveValue('20');
  await page.getByRole('button', { name: 'Previous event' }).click();
  await expect(page.getByRole('slider')).toHaveValue('0');
  await page.getByRole('button', { name: 'Compare baseline' }).click();
  await expect(page.locator('.comparison-path')).toHaveCount(6);
  await page.getByRole('button', { name: /^Inspect Amsterdam AS.*Observed$/ }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toContainText('Route evidence');
  await page.getByRole('button', { name: 'Isolate this observer' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.observer-node')).toHaveCount(1);
  await page.getByRole('button', { name: 'Show all observers', exact: true }).click();
  await expect(page.locator('.observer-node')).toHaveCount(6);
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Zoom level' })).toHaveText('125%');
  await page.getByRole('button', { name: 'Reset view' }).click();
  await expect(page.getByRole('status', { name: 'Zoom level' })).toHaveText('100%');
});

test('observer switching honors the path limit and preserves unknown and gap states', async ({ page }) => {
  await page.goto('/?scenario=incident');
  await openPaths(page);
  await page.getByRole('button', { name: 'Choose observers' }).click();
  const choices = page.getByRole('checkbox');
  await expect(choices.nth(6)).toBeDisabled();
  await choices.nth(0).uncheck();
  await choices.nth(6).check();
  await expect(page.getByRole('dialog', { name: 'Choose observers' })).toContainText('6 of 6 selected');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Choose observers' })).toHaveCount(0);
  await expect(page.locator('.route-row')).toHaveCount(6);
  await expect(page.locator('.route-row').filter({ hasText: 'Singapore' })).toContainText('Unknown baseline');
  await closeExplorer(page);
  await seek(page, 70);
  await page.getByRole('button', { name: /^Inspect Stockholm AS.*Uncertain$/ }).click();
  await expect(page.getByRole('dialog')).toContainText('Reconnected; state still uncertain');
  await closeEvidence(page);
  await seek(page, 90);
  await expect(page.locator('[data-observer="demo-5"] .node-dot')).toHaveClass(/observed/);
});

test('simulated capture continues while presentation is paused', async ({ page }) => {
  await page.goto('/?scenario=incident');
  await page.getByRole('button', { name: 'Play replay', exact: true }).click();
  await expect(page.getByRole('slider')).not.toHaveValue('12');
  await page.getByRole('button', { name: 'Pause replay', exact: true }).click();
  await page.getByRole('button', { name: 'Open explorer' }).click();
  await page.getByRole('button', { name: 'Live demo', exact: true }).click();
  await closeExplorer(page);
  await page.getByRole('button', { name: 'Pause presentation' }).click();
  const held = await page.getByRole('slider').inputValue();
  await page.waitForTimeout(2200);
  await expect(page.getByRole('slider')).toHaveValue(held);
  await page.getByRole('button', { name: 'Return to live demo' }).click();
  await expect(page.getByRole('slider')).not.toHaveValue(held);
});

test('reduced motion, mobile and 200% desktop zoom remain accessible', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?scenario=incident');
  await expectAccessible(page);
  await seek(page, 30);
  await expect(page.locator('[data-observer="demo-1"] .withdrawal-path')).toHaveCSS('opacity', '0');
  if (testInfo.project.name.includes('desktop')) await page.setViewportSize({ width: 720, height: 500 });
  await expect(page.locator('.route-svg')).toHaveAttribute('viewBox', testInfo.project.name.includes('desktop') ? '0 0 1200 330' : '0 0 500 700');
  await expectNoOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('reduced-motion.png'), fullPage: true });
  await openPaths(page);
  await page.getByRole('button', { name: 'Choose observers' }).click();
  await expectAccessible(page);
  await page.screenshot({ path: testInfo.outputPath('observer-chooser.png'), fullPage: true });
});

test('loading, empty, stale and error states have readable recovery actions', async ({ page }, testInfo) => {
  for (const [scenario, expected] of [['loading', 'Loading route snapshot'], ['empty', 'No observations for this interval'], ['error', 'The observation source is unavailable'], ['stale', 'Stale fixture']] as const) {
    await page.goto(`/?scenario=${scenario}`);
    await expect(page.getByRole('main')).toContainText(expected);
    if (scenario === 'stale') await expect(page.locator('.freshness')).toContainText('Stale');
    if (scenario === 'loading' || scenario === 'error') {
      await expect(page.locator('.timeline-track rect')).toHaveCount(0);
      await openPaths(page);
      await expect(page.getByRole('dialog')).toContainText('0 displayed / 8 available');
      await closeExplorer(page);
    }
    await expectNoOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`${scenario}.png`), fullPage: true });
  }
  await page.goto('/?scenario=empty');
  await page.getByRole('button', { name: 'Open demo interval' }).click();
  await expect(page.locator('.observer-node')).toHaveCount(6);
});

test('dense collections draw only six paths and paginate the observer chooser', async ({ page }) => {
  await page.goto('/?scenario=dense');
  await expect(page.locator('.observer-node')).toHaveCount(6);
  await page.getByRole('button', { name: 'Next event' }).click();
  await expect(page.getByRole('slider')).toHaveValue('20');
  await openPaths(page);
  await expect(page.getByRole('dialog')).toContainText('6 displayed / 240 available');
  await page.getByRole('button', { name: 'Choose observers' }).click();
  await expect(page.getByRole('checkbox')).toHaveCount(12);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Choose observers' })).toContainText('Page 2 / 20');
});

test('hidden tabs stop replay and keyboard panning has a reset', async ({ page }) => {
  await page.goto('/?scenario=incident');
  const web = page.getByRole('group', { name: /Interactive route web/ });
  await web.focus();
  await web.press('ArrowRight');
  await expect(page.locator('.route-svg > g')).toHaveAttribute('transform', /translate\(-40,0\)/);
  await web.press('Home');
  await expect(page.locator('.route-svg > g')).toHaveAttribute('transform', /translate\(0,0\) scale\(1\)/);
  await page.getByRole('button', { name: 'Play replay', exact: true }).click();
  await expect(page.getByRole('slider')).not.toHaveValue('12');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(300);
  const held = await page.getByRole('slider').inputValue();
  await page.waitForTimeout(700);
  await expect(page.getByRole('slider')).toHaveValue(held);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(page.getByRole('slider')).not.toHaveValue(held);
});

test('historical routes retain traceable evidence, stable ASs and reversible seeking', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('.freshness')).toContainText('RIPE RIS archive');
  await expect(page.getByRole('slider')).toHaveValue('120');
  await expect(page.locator('.timeline-heading')).toContainText('15:37:00');
  await expect(page.locator('.timeline-labels span').last()).toBeVisible();
  await expect(page.locator('.timeline-labels span').last()).toContainText('21:30:00 UTC');
  const positions = await page.locator('[data-asn]').evaluateAll(nodes => nodes.map(n => [n.getAttribute('data-asn'), n.getAttribute('transform')]));
  await openPaths(page);
  await expect(page.locator('.route-row')).toHaveCount(3);
  await page.locator('.route-row').first().click();
  const evidence = page.getByRole('dialog', { name: 'Route evidence' });
  await expect(evidence).toContainText('Reconstructed baseline');
  await expect(evidence).toContainText('Not recorded in MRT');
  await evidence.getByText('Supporting archive record', { exact: true }).click();
  await expect(evidence.locator('.evidence-record')).toContainText('"sourceTime": "2021-10-04T08:00:00Z"');
  await expect(evidence.getByRole('link', { name: 'Open supporting MRT archive' })).toHaveAttribute('href', 'https://data.ris.ripe.net/rrc06/2021.10/bview.20211004.0800.gz');
  await closeEvidence(page);
  await expect(page.getByRole('button', { name: /Observers \d/ })).toBeFocused();
  await seek(page, 900);
  await expect(page.locator('.node-dot.withdrawn')).toHaveCount(3);
  await expect(page.locator('.quiet-label')).toHaveText('No observed path.');
  await page.locator('.observer-node').first().click();
  await expect(evidence).toContainText('2021-10-04T15:45:51Z');
  await evidence.getByText('Supporting archive record', { exact: true }).click();
  await expect(evidence.locator('.evidence-record')).toContainText('updates.20211004.1545.gz');
  await expect(evidence.locator('.evidence-record')).toContainText('"elem_type": "W"');
  await closeEvidence(page);
  await seek(page, 21300);
  await expect(page.locator('.node-dot.observed')).toHaveCount(3);
  await seek(page, 120);
  expect(await page.locator('[data-asn]').evaluateAll(nodes => nodes.map(n => [n.getAttribute('data-asn'), n.getAttribute('transform')]))).toEqual(positions);
  await expectAccessible(page);
  await expectNoOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('historical-replay.png'), fullPage: true });
  await page.getByRole('button', { name: 'Open explorer' }).click();
  await expect(page.getByRole('button', { name: 'Live demo', exact: true })).toBeDisabled();
  await page.getByRole('combobox', { name: 'Replay collection' }).click();
  await page.getByRole('option', { name: 'Facebook outage · synthetic replay', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Live demo', exact: true })).toBeEnabled();
  await closeExplorer(page);
  await expect(page.locator('.freshness')).toContainText('Synthetic data');
  await expect(page.locator('.observer-node')).toHaveCount(6);
});

test('the sidebar traps focus, closes with Escape and returns focus to its opener', async ({ page }) => {
  await page.goto('/');
  const opener = page.getByRole('button', { name: 'Open explorer' });
  await opener.click();
  const panel = page.getByRole('dialog', { name: 'Explore' });
  await expect(panel).toBeVisible();
  for (let i = 0; i < 9; i++) await page.keyboard.press('Tab');
  expect(await panel.evaluate(el => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(opener).toBeFocused();
  await page.getByRole('button', { name: 'Next event' }).click();
  await expect(page.getByRole('slider')).not.toHaveValue('120');
});

test('route changes animate to their final state and reduced motion skips drawing', async ({ page }) => {
  await page.goto('/?scenario=incident&t=30');
  await expect(page.locator('[data-observer="demo-1"] .observer-path')).toHaveCSS('opacity', '0');
  await seek(page, 90);
  const path = page.locator('[data-observer="demo-1"] .observer-path');
  await expect(path).toHaveCSS('opacity', '1');
  await expect(path).toHaveAttribute('data-route-state', 'observed');
  await seek(page, 30);
  await expect(path).toHaveCSS('opacity', '0');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seek(page, 90);
  await expect(path).toHaveCSS('opacity', '1');
  await expect(page.locator('.line-annotation')).toContainText('observed AS path');
  await seek(page, 70);
  const uncertain = page.locator('[data-observer="demo-5"] .observer-path');
  await expect(uncertain).toHaveCSS('stroke', 'rgb(215, 190, 144)');
  const visibleDashes = await uncertain.evaluate((el: SVGPathElement) => {
    const pattern = getComputedStyle(el).strokeDasharray.split(/[, ]+/).map(parseFloat);
    // pathLength normalizes stroke units; a dash longer than the path hides uncertainty.
    const units = el.hasAttribute('pathLength') ? Number(el.getAttribute('pathLength')) : el.getTotalLength();
    return units / (pattern[0] + pattern[1]);
  });
  expect(visibleDashes).toBeGreaterThan(10);
});
