import AxeBuilder from '@axe-core/playwright';
import { type Browser, type BrowserContextOptions, type Page, expect, test } from '@playwright/test';
import { renderSVG } from 'uqr';
import { WORLDS } from '../src/worlds';
import { goToStop, watchErrors } from './helpers';

const worlds = Object.keys(WORLDS);
/** The stop each world's round trip shares from. */
const away: Record<string, string> = { 'slow-light': 'Whose now?', 'big-hbar': 'Two openings', 'big-g': 'Weigh the hole' };

/** Open an address and wait until the app has entered `world` (and restored whatever the address names). */
async function enter(page: Page, url: string, world: string) {
  await page.goto(url);
  await page.waitForFunction((id) => (window as any).slowlight?.world === id, world, { timeout: 60_000 });
}

const setupOf = (page: Page) => page.evaluate(() => (window as any).slowlight.setup);
/**
 * Each of the world's switches as its control shows it: an effect's checkbox, or whether a way of looking (World I's
 * Measured map) is pressed. World I's Comfort reticle is the visitor's own setting, not the world's, and links leave it out.
 */
async function shown(page: Page) {
  const ids = Object.keys((await setupOf(page)).switches);
  return page.evaluate(
    (ids) =>
      Object.fromEntries(
        ids.map((id) => {
          const box = document.querySelector<HTMLInputElement>(`[data-toggle="${id}"]`);
          const view = document.querySelector(`[data-view="${id}"]`);
          return [id, box ? box.checked : view ? view.getAttribute('aria-pressed') === 'true' : null];
        }),
      ),
    ids,
  );
}
const search = (page: Page) => new URL(page.url()).search;
/** With World I's Measured map open, the Dials panel waits behind its button: open it, as a visitor would. */
async function openPanel(page: Page) {
  if (!(await page.locator('[data-share]').isVisible())) await page.locator('.panel-toggle').click();
}

// Software rendering draws Big G well under one frame a second, and each of these tests opens a world several times.
test.slow();

test('the classroom example link opens Terrell rotation with Doppler colour on, light delay off and c = 30', async ({ page }) => {
  const errors = watchErrors(page);
  const link = '?world=slow-light&stop=terrell-rotation&on=doppler&off=delay&c=30';
  await enter(page, `./${link}&quality=low&e2e`, 'slow-light');
  await expect(page.locator('.tour-title')).toHaveText('Terrell rotation');
  expect(await page.evaluate(() => (window as any).slowlight.tour)).toBe(5);
  await expect(page.locator('[data-toggle="doppler"]')).toBeChecked();
  await expect(page.locator('[data-toggle="beaming"]')).not.toBeChecked();
  await expect(page.locator('[data-toggle="delay"]')).not.toBeChecked();
  await expect(page.locator('[data-toggle="adapt"]')).toBeChecked();
  expect(await page.evaluate(() => (window as any).slowlight.constants.c)).toBe(30);
  await expect(page.locator('.dial-value').first()).toContainText('30 m/s');
  expect(search(page)).toBe(`${link}&quality=low`);
  await page.locator('[data-share]').click();
  expect(search(page)).toBe(link);
  expect(errors).toEqual([]);
});

for (const id of worlds) {
  test(`${id}: a shared stop, switches and dial reopen exactly, and Share writes the same link back`, async ({ page }) => {
    const errors = watchErrors(page);
    await enter(page, `./?world=${id}&quality=low&e2e`, id);
    await goToStop(page, away[id]);
    await openPanel(page);
    const own = (await setupOf(page)).switches;
    const boxes = await page.locator('[data-toggle]').evaluateAll((els) => els.map((el) => [el.getAttribute('data-toggle')!, (el as HTMLInputElement).checked] as const));
    const flipped: Record<string, boolean> = {};
    for (const wanted of [true, false]) {
      const box = boxes.find(([id, on]) => id in own && on === wanted);
      if (box) await page.locator(`[data-toggle="${box[0]}"]`).setChecked((flipped[box[0]] = !wanted), { force: true });
    }
    for (const view of await page.locator('.topbar [data-view]').all()) await view.click();
    await page.locator('[data-dial]').evaluate((el: HTMLInputElement) => {
      el.value = '700';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const shared = await setupOf(page);
    expect(shared.switches).toMatchObject(flipped);
    await page.locator('[data-share]').click();
    const link = page.url();
    expect(link).toMatch(new RegExp(`\\?world=${id}&stop=[a-z0-9-]+&(on|off)=.*&(c|hbar|G)=[0-9.e-]+$`));

    await enter(page, `${link}&quality=low&e2e`, id);
    expect(await setupOf(page)).toEqual(shared);
    expect(await shown(page)).toEqual(shared.switches);
    expect(page.url()).toBe(`${link}&quality=low`);
    await openPanel(page);
    await page.locator('[data-share]').click();
    expect(page.url()).toBe(link);
    expect(errors).toEqual([]);
  });

  test(`${id}: a hostile link opens stop 1 as authored, with no errors`, async ({ page }) => {
    const errors = watchErrors(page);
    const hostile = new URLSearchParams({ world: id, quality: 'low', stop: '__proto__', on: '__proto__,constructor,toString', off: 'x'.repeat(10_000), c: '0x10', hbar: '-5', G: 'NaN', view: '<script>alert(1)</script>' });
    await enter(page, `./?${hostile}&e2e`, id);
    await expect(page.locator('.tour-no')).toHaveText(/^1 \//);
    // The address bar shows the canonical link, which names only what differs from the stop as authored: nothing.
    expect(search(page)).toBe(`?world=${id}&quality=low`);
    expect(await shown(page)).toEqual((await setupOf(page)).switches);
    expect(errors).toEqual([]);
  });
}

test('an id that is not a world opens the title screen', async ({ page }) => {
  const errors = watchErrors(page);
  for (const notAWorld of ['constructor', '__proto__', 'toString']) {
    await page.goto(`./?world=${notAWorld}&e2e`);
    await expect(page.locator('.plate')).toHaveCount(3);
    expect(await page.evaluate(() => (window as any).slowlight.world)).toBeNull();
  }
  expect(errors).toEqual([]);
});

test('the title screen links to the teacher pages', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./?e2e');
  await page.locator('[data-teach]').click();
  await expect(page).toHaveURL(/\/teach\.html$/);
  await expect(page.locator('.world')).toHaveCount(worlds.length);
  for (const id of worlds) {
    await expect(page.locator(`.world[data-world="${id}"] a[href="?guide=${id}"]`)).toHaveText('Teacher page');
    await expect(page.locator(`.world[data-world="${id}"] a[href="?sheet=${id}"]`)).toHaveText('Student sheet');
  }
  expect(errors).toEqual([]);
});

test.describe('the kit pages, in a browser without WebGL', () => {
  let browser: Browser;
  test.beforeAll(async ({ playwright }) => {
    browser = await playwright.chromium.launch({ args: ['--disable-3d-apis'] });
  });
  test.afterAll(() => browser.close());

  /** Open teach.html with a query and wait until it is drawn, fonts and all. */
  async function kitPage(baseURL: string | undefined, query: string, options: BrowserContextOptions = {}) {
    const context = await browser.newContext({ baseURL, ...options });
    // With sound left on in the app, a page that armed audio would start it on the first click, and throw here.
    await context.addInitScript(() => {
      localStorage.setItem('slowlight-sound', 'on');
      Object.defineProperty(window, 'AudioContext', {
        value: class {
          constructor() {
            throw new Error('a kit page started audio');
          }
        },
      });
    });
    const page = await context.newPage();
    const errors = watchErrors(page);
    await page.goto(`./teach.html?${query}`);
    await page.waitForSelector('body[data-ready]');
    expect(await page.evaluate(() => ['webgl2', 'webgl'].some((kind) => document.createElement('canvas').getContext(kind)))).toBe(false);
    return { page, errors };
  }

  const serious = async (page: Page) => (await new AxeBuilder({ page }).analyze()).violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`);

  for (const id of worlds) {
    test(`${id}: the student sheet prints on one page, with a code for each activity and no answers`, async ({ baseURL }) => {
      const guide = (await kitPage(baseURL, `guide=${id}`)).page;
      const links = await guide.locator('.step a.link').evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
      const reasons = await guide.locator('.why').allTextContents();
      const { page, errors } = await kitPage(baseURL, `sheet=${id}`);
      await expect(page.locator('canvas')).toHaveCount(0);

      const codes = page.locator('.activity .qr');
      await expect(codes).toHaveCount(links.length);
      for (const [i, code] of (await codes.all()).entries()) {
        expect(await code.getAttribute('href')).toBe(links[i]);
        expect(await code.locator('svg path').getAttribute('d'), 'the code encodes its link').toBe(/ d="([^"]+)"/.exec(renderSVG(links[i], { ecc: 'M', border: 4 }))![1]);
      }
      const sheet = await page.locator('.sheet').innerText();
      expect(sheet).not.toMatch(/Answer: [a-d]\)/);
      for (const why of reasons) expect(sheet).not.toContain(why);

      for (const format of ['A4', 'Letter'] as const) {
        const pdf = await page.pdf({ format, margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' } });
        expect(pdf.toString('latin1').match(/\/Type\s*\/Page(?![a-zA-Z])/g), format).toHaveLength(1);
      }
      // A page count alone passes when content is clipped: every box and every line of text must lie inside the
      // 190 × 259 mm that A4 and Letter both print.
      await page.emulateMedia({ media: 'print' });
      const outside = await page.evaluate(() => {
        const mm = 96 / 25.4;
        const sheet = document.querySelector('.sheet')!;
        const box = sheet.getBoundingClientRect();
        const out: string[] = [];
        if (box.left !== 0 || box.top !== 0 || Math.abs(box.width - 190 * mm) > 1 || Math.abs(box.height - 259 * mm) > 1) out.push(`the sheet is at ${box.left},${box.top}, ${box.width}×${box.height} px`);
        if (document.documentElement.scrollHeight > 259 * mm + 1) out.push(`the page is ${document.documentElement.scrollHeight} px tall`);
        const walk = document.createTreeWalker(sheet, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
        for (let node: Node | null = walk.currentNode; node; node = walk.nextNode()) {
          const range = document.createRange();
          range.selectNodeContents(node);
          const r = node instanceof Element ? node.getBoundingClientRect() : range.getBoundingClientRect();
          if ((r.width || r.height) && (r.right > box.left + 190 * mm + 0.5 || r.bottom > box.top + 259 * mm + 0.5)) out.push(`${node.nodeName} “${node.textContent!.slice(0, 40)}” ends at ${(r.right / mm).toFixed(1)} × ${(r.bottom / mm).toFixed(1)} mm`);
        }
        return out;
      });
      expect(outside).toEqual([]);
      await page.emulateMedia({ media: 'screen' });
      expect(await serious(page)).toEqual([]);
      expect(errors).toEqual([]);
    });

    test(`${id}: the teacher page times a 15-minute lesson, gives every answer a reason and copies every link`, async ({ baseURL }) => {
      const { page, errors } = await kitPage(baseURL, `guide=${id}`, { permissions: ['clipboard-read', 'clipboard-write'] });
      // Print prints this page; the sheet the class needs is one click away, beside it.
      await expect(page.locator('.bar > *')).toHaveText(['← All worlds', 'Print', 'Student sheet to print for the class']);
      await expect(page.locator('.bar a').last()).toHaveAttribute('href', `?sheet=${id}`);
      const minutes = (await page.locator('.step .meta').allTextContents()).map((meta) => parseInt(meta));
      expect(minutes.reduce((sum, m) => sum + m, 0)).toBe(15);
      await expect(page.locator('.syllabus tbody tr').first()).toBeVisible();
      const answered = await page.locator('.answered').all();
      expect(answered.length).toBeGreaterThan(0);
      for (const block of answered) {
        await expect(block.locator('.answer')).toHaveText(/^Answer: [a-d]\) \S/);
        await expect(block.locator('.why')).toHaveText(/\S{2}/);
      }

      const stops = page.locator('.stops > li');
      const total = Number(/of (\d+)/.exec((await stops.first().locator('.meta').textContent())!)![1]);
      await expect(stops).toHaveCount(total);
      const links = await page.locator('.stops a.link').evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
      expect(new Set(links).size).toBe(total);
      await page.locator('[data-copy-links]').click();
      await expect(page.locator('.copied')).toHaveText(`Copied ${total} links.`);
      const copied = await page.evaluate(() => navigator.clipboard.readText());
      expect(copied.split('\n').map((line) => line.split(' ').at(-1))).toEqual(links);
      await page.setViewportSize({ width: 360, height: 740 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth), 'no sideways scrolling on a phone').toBe(360);

      expect(await serious(page)).toEqual([]);
      expect(errors).toEqual([]);
    });
  }

  test('a query that names no world shows the index', async ({ baseURL }) => {
    for (const query of ['sheet=__proto__', 'guide=constructor', 'sheet=toString', 'guide=', 'sheet=slow-light%00', 'x=1']) {
      const { page, errors } = await kitPage(baseURL, query);
      await expect(page.locator('.world')).toHaveCount(worlds.length);
      expect(await serious(page)).toEqual([]);
      expect(errors).toEqual([]);
    }
  });
});

for (const id of worlds) {
  test(`${id}: each activity on the sheet opens its stop as authored, with the answer and reason the teacher page gives`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(`./teach.html?guide=${id}`);
    await page.waitForSelector('body[data-ready]');
    const steps = await page.locator('.step').evaluateAll((els) =>
      els.map((el) => ({
        stop: /Stop (\d+) of/.exec(el.querySelector('.meta')!.textContent!)![1],
        title: el.querySelector('h3')!.textContent!,
        link: el.querySelector<HTMLAnchorElement>('a.link')!.href,
        answer: el.querySelector('.answer')?.textContent!.replace(/^Answer: [a-d]\) /, '') ?? null,
        why: el.querySelector('.why')?.textContent ?? null,
        measure: el.querySelector('.measure .q')?.textContent ?? null,
      })),
    );
    test.setTimeout(90_000 * (steps.length + 1));
    for (const step of steps) {
      await enter(page, `${step.link}&quality=low&e2e`, id);
      await expect(page.locator('.tour-title')).toHaveText(step.title);
      await expect(page.locator('.tour-no')).toHaveText(new RegExp(`^${step.stop} /`));
      expect(await shown(page), step.title).toEqual((await setupOf(page)).switches);
      if (step.measure !== null) {
        // The app, not the kit, works the true values out, from where the student stands.
        await expect(page.locator('.predict-q')).toContainText(step.measure);
        await page.getByRole('button', { name: 'Just show me' }).click();
        await expect(page.locator('.predict-reveal')).toHaveText(/\d/);
      } else if (step.answer === null) await expect(page.locator('.predict')).toBeHidden();
      else {
        await page.getByRole('button', { name: 'Just show me' }).click();
        await expect(page.locator('.predict-reveal')).toHaveText(step.why!);
        await expect(page.locator('.choice[data-state="right"]')).toHaveText(step.answer);
      }
      // Share writes only what differs from the stop as authored, so getting the activity's own link back means the
      // world shows exactly that stop's switches and dials.
      await openPanel(page);
      await page.locator('[data-share]').click();
      expect(page.url()).toBe(step.link);
    }
    expect(errors).toEqual([]);
  });
}
