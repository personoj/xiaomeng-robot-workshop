import {test, expect} from '@playwright/test';

// These require a real browser and the served workshop build. They do not cover
// an attached device, audible quality, or full-workload GPU performance.
const panel = page => page.locator('#principle-panel');
const state = page => page.evaluate(() => window.xiaomengPrinciples.state());
async function openMain(page) {
  await page.goto('/');
  await expect(panel(page).locator('.principle-play')).toBeVisible();
}

test('all four lessons, native keyboard seek, retained chapter focus, replay and source', async ({page}) => {
  await openMain(page);
  for (const topic of ['coordinates','inverse_kinematics','pointnet','planning']) {
    const button=panel(page).locator(`[data-lesson-topic="${topic}"]`);
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed','true');
    await expect.poll(async () => (await state(page)).topic).toBe(topic);
    await panel(page).locator('.principle-play').click();
    await expect.poll(async () => (await state(page)).status).toBe('paused');
  }
  const seek=panel(page).getByRole('slider');
  await seek.focus(); await seek.press('Home'); await seek.press('ArrowRight');
  await expect.poll(async () => (await state(page)).elapsed).toBeGreaterThan(0);
  await expect(seek).toBeFocused();
  const chapter=panel(page).locator('[data-lesson-step="1"]');
  await chapter.focus(); await chapter.press('Enter');
  await expect.poll(async () => (await state(page)).step).toBe(1);
  await page.evaluate(() => window.xiaomengPrinciples.seekStep(2));
  await expect(chapter).toBeFocused();
  await expect(panel(page).locator('[data-lesson-step="2"]')).toHaveAttribute('aria-current','step');
  await page.evaluate(() => {const api=window.xiaomengPrinciples; api.seek(api.state().duration);});
  await expect(panel(page).locator('.principle-play')).toHaveText('再听一次');
  await panel(page).locator('.principle-play').click();
  await expect.poll(async () => (await state(page)).elapsed).toBeLessThan(3);
  await expect(panel(page).locator('.principle-audio-status')).toContainText('本页原声');
  await expect(panel(page).locator('.principle-source')).toBeVisible();
  await expect(panel(page).locator('.principle-source')).toHaveAttribute('href',/^https:\/\//);
});

test('denied browser autoplay offers working click recovery', async ({page}) => {
  await page.addInitScript(() => {
    const original=HTMLMediaElement.prototype.play;
    let first=true;
    HTMLMediaElement.prototype.play=function() {
      if (first) {first=false; return Promise.reject(new DOMException('Synthetic autoplay denial','NotAllowedError'));}
      return original.call(this);
    };
  });
  await openMain(page);
  await panel(page).locator('[data-lesson-topic="coordinates"]').click();
  await expect(panel(page).locator('.principle-audio-status')).toContainText('点击播放');
  await expect(panel(page).locator('.principle-play')).toHaveText('播放讲解');
  await panel(page).locator('.principle-play').click();
  await expect.poll(async () => (await state(page)).elapsed).toBeGreaterThan(0);
});

test('failed recorded-audio request retries without requiring voice setup', async ({page}) => {
  await page.route('**/*.wav', route => route.abort());
  await openMain(page);
  await panel(page).locator('[data-lesson-topic="coordinates"]').click();
  await expect(panel(page).locator('.principle-play')).toHaveText('重试播放');
  await page.unroute('**/*.wav');
  await panel(page).locator('.principle-play').click();
  await expect.poll(async () => (await state(page)).elapsed).toBeGreaterThan(0);
});

test('studio retains a single transport and keeps script, topic and player aligned', async ({page}) => {
  await page.goto('/principle-studio.html?topic=coordinates');
  await expect(page.locator('.studio-visual .principle-topics')).toBeHidden();
  await expect(page.locator('.studio-visual .principle-controls')).toBeHidden();
  await expect(page.locator('.studio-transport')).toBeVisible();
  await page.locator('.topic-tabs [data-topic="planning"]').click();
  await page.locator('#play').click();
  await expect.poll(async () => (await state(page)).topic).toBe('planning');
  await expect(page.locator('#script-list li').first()).toContainText('碰撞');
  const chapter=page.locator('[data-lesson-step="2"]');
  await chapter.click();
  await expect(page.locator('#script-list li').nth(2)).toHaveAttribute('data-current','true');
  await page.locator('#replay').click();
  await expect.poll(async () => (await state(page)).topic).toBe('planning');
});

for (const viewport of [{width:1920,height:1080},{width:1440,height:900},{width:1280,height:720},{width:1080,height:720},{width:390,height:844}]) {
  test(`lesson controls remain reachable at ${viewport.width}×${viewport.height}`, async ({page}, testInfo) => {
    await page.setViewportSize(viewport); await page.emulateMedia({reducedMotion:'reduce'});
    await openMain(page);
    await page.evaluate(() => window.xiaomengPrinciples.start('coordinates',{autoplay:false}));
    const play=panel(page).locator('.principle-play');
    await play.scrollIntoViewIfNeeded(); await expect(play).toBeInViewport();
    const bounds=await play.boundingBox(); expect(bounds.height).toBeGreaterThanOrEqual(44);
    await play.focus(); await expect(play).toBeFocused();
    const focus=await play.evaluate(el => ({style:getComputedStyle(el).outlineStyle,width:parseFloat(getComputedStyle(el).outlineWidth)}));
    expect(focus.style).not.toBe('none'); expect(focus.width).toBeGreaterThanOrEqual(2);
    const overflow=await panel(page).evaluate(el => {
      const board=el.querySelector('.principle-board').getBoundingClientRect();
      const note=el.querySelector('.principle-control-note').getBoundingClientRect();
      return {document:document.documentElement.scrollWidth>innerWidth+1,clipped:note.bottom>board.bottom+1};
    });
    expect(overflow.document).toBe(false); expect(overflow.clipped).toBe(false);
    await page.screenshot({path:testInfo.outputPath(`lesson-${viewport.width}.png`),fullPage:true});
  });
}
