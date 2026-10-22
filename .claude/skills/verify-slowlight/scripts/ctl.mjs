#!/usr/bin/env node
// Drive a real Slowlight build the way a visitor does: one long-lived headless Chromium, one command per call.
// Usage: node .claude/skills/verify-slowlight/scripts/ctl.mjs <command> [args]   (see SKILL.md for the list)
import { chromium } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const self = fileURLToPath(import.meta.url);
const repo = path.resolve(self, '../../../../..');
const port = Number(process.env.VERIFY_PORT ?? 4317);
const cdpPort = port + 1000;
const phone = process.env.VERIFY_DEVICE === 'phone';
const motion = process.env.VERIFY_MOTION === 'reduce' ? 'reduce' : 'no-preference';
const dir = process.env.VERIFY_DIR ?? path.join(os.tmpdir(), `verify-slowlight-${port}`);
const evidence = path.join(dir, 'evidence');
const stateFile = path.join(dir, 'state.json');
const consoleLog = path.join(dir, 'console.log');
const base = `http://localhost:${port}/`;
const [cmd, ...args] = process.argv.slice(2);

const print = (v) => console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 1));
const fail = (msg) => {
  console.error(`ctl: ${msg}`);
  process.exit(1);
};
const readState = () => (fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : null);
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
async function until(check, ms) {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 250))) if (await check().catch(() => false)) return true;
  return false;
}
const ready = async (check, ms, what) => (await until(check, ms)) || fail(`${what} not ready after ${ms / 1000} s; see ${dir}/*.log, then run cleanup`);

/** Everything the visitor can see at once, read back from the page and the read-only probe. */
const snapshot = (page) =>
  page.evaluate(() => {
    const s = window.slowlight;
    const text = (sel) => document.querySelector(sel)?.textContent?.trim() || null;
    return {
      url: location.pathname + location.search,
      mode: document.body.dataset.mode,
      world: s?.world ?? null,
      frames: s?.frames ?? 0,
      constants: s?.constants,
      tour: s?.world ? { stop: text('.tour-no'), title: text('.tour-title'), predicting: !!document.querySelector('.chrome.predicting') } : undefined,
      toggles: Object.fromEntries([...document.querySelectorAll('[data-toggle]')].map((b) => [b.dataset.toggle, b.checked])),
      readouts: s?.world ? Object.fromEntries(s.readouts().map((r) => [r.label, r.value])) : undefined,
      status: s?.world ? s.status() : undefined,
      toast: text('.toast.show'),
      gpuReset: text('#gpu-reset'),
      proofs: text('.proofs-summary'),
    };
  });

async function frames(page, n) {
  const start = await page.evaluate(() => window.slowlight?.frames ?? 0);
  await page.waitForFunction((s) => window.slowlight?.frames >= s, start + n, { timeout: 60_000 });
}

/** `--role button --name "Next tour stop"`, `--label "Rendering quality"`, or any Playwright selector. */
function target(page, a) {
  const flag = (f) => (a.includes(f) ? a[a.indexOf(f) + 1] : undefined);
  if (flag('--role')) return page.getByRole(flag('--role'), flag('--name') ? { name: flag('--name'), exact: true } : {});
  if (flag('--label')) return page.getByLabel(flag('--label'), { exact: true });
  if (!a[0]) fail('name a target: --role <role> --name <name>, --label <label>, or a selector');
  return page.locator(a[0]);
}

async function withPage(fn) {
  const s = readState();
  if (!s || !alive(s.browser)) fail('no running instance; run launch first');
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
  try {
    const page = browser.contexts()[0]?.pages()[0];
    if (!page) fail('the browser has no page; run cleanup, then launch');
    // Each connection starts from the default media features, so ask again for the motion preference set at launch.
    await page.emulateMedia({ reducedMotion: s.motion ?? 'no-preference' });
    return await fn(page);
  } finally {
    await browser.close(); // disconnects only; the instance keeps running
  }
}

/** Touch drag through the browser, as a thumb would: press, move in steps, hold, lift. */
async function swipe(page, [x0, y0, x1, y1, hold = 0]) {
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  await touch('touchStart', +x0, +y0);
  for (let i = 1; i <= 10; i++) await touch('touchMove', +x0 + ((x1 - x0) * i) / 10, +y0 + ((y1 - y0) * i) / 10);
  await page.waitForTimeout(+hold);
  await touch('touchEnd');
  await cdp.detach();
}

const commands = {
  async launch() {
    const s = readState();
    if (s && (alive(s.preview) || alive(s.browser))) fail(`an instance is already running on ${base}; run cleanup first`);
    fs.rmSync(path.join(dir, 'profile'), { recursive: true, force: true });
    fs.mkdirSync(evidence, { recursive: true });
    if (!args.includes('--no-build')) execFileSync('npm', ['run', 'build'], { cwd: repo, stdio: ['ignore', 'inherit', 'inherit'] });
    const out = fs.openSync(path.join(dir, 'preview.log'), 'a');
    const preview = spawn(process.execPath, [path.join(repo, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(port), '--strictPort'], { cwd: repo, detached: true, stdio: ['ignore', out, out] });
    const blog = fs.openSync(path.join(dir, 'browser.log'), 'a');
    const browser = spawn(process.execPath, [self, 'browserd'], { cwd: repo, detached: true, stdio: ['ignore', blog, blog] });
    preview.unref();
    browser.unref();
    fs.writeFileSync(stateFile, JSON.stringify({ base, preview: preview.pid, browser: browser.pid, device: phone ? 'phone' : 'desktop', motion, launchedAt: new Date().toISOString() }));
    await ready(() => fetch(base).then((r) => r.ok), 30_000, 'preview server');
    await ready(() => fetch(`http://127.0.0.1:${cdpPort}/json/version`).then((r) => r.ok), 60_000, 'browser');
    await withPage(async (page) => {
      await page.goto(base);
      await page.locator('.plate').first().waitFor();
      print({ ready: base, device: phone ? 'phone' : 'desktop', motion, evidence, ...(await snapshot(page)) });
    });
  },

  /** Internal: the long-lived browser that `launch` starts. Records console errors for `errors`. */
  async browserd() {
    const device = phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport: { width: 1280, height: 800 } };
    const ctx = await chromium.launchPersistentContext(path.join(dir, 'profile'), {
      headless: true,
      ...device,
      reducedMotion: motion,
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', `--remote-debugging-port=${cdpPort}`],
    });
    const record = (page) => {
      page.on('console', (m) => ['error', 'warning'].includes(m.type()) && fs.appendFileSync(consoleLog, `${new Date().toISOString()} ${m.type()} ${page.url()} ${m.text()}\n`));
      page.on('pageerror', (e) => fs.appendFileSync(consoleLog, `${new Date().toISOString()} pageerror ${page.url()} ${e.message}\n`));
    };
    ctx.pages().forEach(record);
    ctx.on('page', record);
    process.on('SIGTERM', () => ctx.close().finally(() => process.exit(0)));
  },

  async doctor() {
    const s = readState();
    const report = { base, dir, running: !!s && alive(s.preview) && alive(s.browser), device: s?.device, motion: s?.motion };
    if (report.running) {
      const served = await fetch(base).then((r) => r.text()).catch(() => '');
      report.servesThisBuild = served === fs.readFileSync(path.join(repo, 'dist/index.html'), 'utf8');
      const built = fs.statSync(path.join(repo, 'dist/index.html')).mtimeMs;
      const newest = (p) => (fs.statSync(p).isDirectory() ? Math.max(0, ...fs.readdirSync(p).map((f) => newest(path.join(p, f)))) : fs.statSync(p).mtimeMs);
      report.buildIsFresh = ['src', 'index.html', 'vite.config.ts'].every((p) => !fs.existsSync(path.join(repo, p)) || newest(path.join(repo, p)) <= built);
      Object.assign(
        report,
        await withPage((page) =>
          page.evaluate(() => {
            const gl = document.createElement('canvas').getContext('webgl2');
            return { page: location.href, probe: typeof window.slowlight === 'object', webgl2: !!gl, floatTargets: !!gl?.getExtension('EXT_color_buffer_float') };
          }),
        ),
      );
    }
    const lines = fs.existsSync(consoleLog) ? fs.readFileSync(consoleLog, 'utf8').split('\n') : [];
    report.consoleErrors = lines.filter((l) => / (error|pageerror) /.test(l)).length;
    report.ok = report.running && report.servesThisBuild && report.buildIsFresh && report.probe && report.webgl2 && report.floatTargets;
    print(report);
    process.exit(report.ok ? 0 : 1);
  },

  go: () =>
    withPage(async (page) => {
      await page.goto(new URL(args[0] ?? '', base).href);
      if (/[?&]world=/.test(args[0] ?? '')) await frames(page, 8);
      else await page.waitForLoadState('load');
      print(await snapshot(page));
    }),
  click: () =>
    withPage(async (page) => {
      await target(page, args).click();
      await page.waitForTimeout(200);
      print(await snapshot(page));
    }),
  press: () =>
    withPage(async (page) => {
      const [key, ...rest] = args;
      if (rest.length) await target(page, rest).press(key);
      else await page.keyboard.press(key);
      await page.waitForTimeout(200);
      print(await snapshot(page));
    }),
  hold: () =>
    withPage(async (page) => {
      const keys = args[0].split('+');
      for (const k of keys) await page.keyboard.down(k);
      await page.waitForTimeout(Number(args[1] ?? 1000));
      for (const k of keys.reverse()) await page.keyboard.up(k);
      print(await snapshot(page));
    }),
  swipe: () =>
    withPage(async (page) => {
      await swipe(page, args);
      print(await snapshot(page));
    }),
  frames: () =>
    withPage(async (page) => {
      await frames(page, Number(args[0] ?? 30));
      print(await snapshot(page));
    }),
  probe: () => withPage(async (page) => print(await snapshot(page))),
  /** Text of every match the visitor can see; hidden matches are left out. SVG text (the Measured map) has no innerText. */
  text: () =>
    withPage(async (page) => {
      const out = [];
      for (const el of await target(page, args).all()) if (await el.isVisible()) out.push(await el.evaluate((e) => (e instanceof HTMLElement ? e.innerText : e.textContent)));
      print(out);
    }),
  select: () =>
    withPage(async (page) => {
      const [value, ...rest] = args;
      await target(page, rest).selectOption(value);
      await page.waitForTimeout(200);
      print(await snapshot(page));
    }),
  /** Freeze or release time (the probe's only setter), to compare two views of the very same moment. */
  pause: () =>
    withPage(async (page) => {
      await page.evaluate((on) => window.slowlight.pause(on), args[0] !== 'off');
      print(await snapshot(page));
    }),
  /** Lose or restore the view's WebGL context (WEBGL_lose_context), as a graphics card reset does. Not a visitor action. */
  gpu: () =>
    withPage(async (page) => {
      if (args[0] !== 'lose' && args[0] !== 'restore') fail('gpu takes lose or restore');
      await page.evaluate((call) => {
        // A lost context hands out no extensions, so keep the one that restores it.
        window.ctlLoseContext ??= document.querySelector('#view').getContext('webgl2').getExtension('WEBGL_lose_context');
        window.ctlLoseContext[call]();
      }, args[0] === 'lose' ? 'loseContext' : 'restoreContext');
      await page.waitForTimeout(200);
      print(await snapshot(page));
    }),
  shot: () =>
    withPage(async (page) => {
      const file = path.join(evidence, `${args[0] ?? 'shot'}.png`);
      await page.screenshot({ path: file });
      print(file);
    }),
  aria: () =>
    withPage(async (page) => {
      const file = path.join(evidence, `${args[0] ?? 'page'}.aria.yml`);
      fs.writeFileSync(file, await page.locator('body').ariaSnapshot());
      print(file);
    }),
  /** Mean and spread of the view's luminance on a 32×20 grid. Needs `e2e` in the URL to keep the drawing buffer. */
  sample: () =>
    withPage(async (page) => {
      // A world tidies e2e out of the address bar, so look at the address the page was loaded from.
      const loaded = await page.evaluate(() => performance.getEntriesByType('navigation')[0]?.name ?? location.href);
      if (!/[?&]e2e/.test(loaded)) fail('sample needs a page opened with e2e in the URL (it keeps the drawing buffer)');
      print(
        await page.evaluate(() => {
          const c = Object.assign(document.createElement('canvas'), { width: 32, height: 20 });
          const g = c.getContext('2d');
          g.drawImage(document.querySelector('#view'), 0, 0, 32, 20);
          const d = g.getImageData(0, 0, 32, 20).data;
          const lum = [];
          for (let i = 0; i < d.length; i += 4) lum.push(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]);
          const mean = lum.reduce((a, b) => a + b, 0) / lum.length;
          return { mean: +mean.toFixed(1), spread: +Math.sqrt(lum.reduce((a, b) => a + (b - mean) ** 2, 0) / lum.length).toFixed(1) };
        }),
      );
    }),
  async errors() {
    const lines = fs.existsSync(consoleLog) ? fs.readFileSync(consoleLog, 'utf8').trim().split('\n').filter(Boolean) : [];
    print({ errors: lines.filter((l) => / (error|pageerror) /.test(l)).length, lines });
  },

  async cleanup() {
    const s = readState();
    for (const pid of [s?.browser, s?.preview].filter(Boolean)) {
      if (!alive(pid)) continue;
      process.kill(-pid, 'SIGTERM'); // each was started as its own process group, so this reaches its children too
      if (!(await until(async () => !alive(pid), 10_000))) process.kill(-pid, 'SIGKILL');
    }
    fs.rmSync(path.join(dir, 'profile'), { recursive: true, force: true });
    fs.rmSync(stateFile, { force: true });
    print({ stopped: base, evidenceKept: evidence });
  },
};

if (!commands[cmd]) fail(`unknown command "${cmd ?? ''}"; one of: ${Object.keys(commands).filter((c) => c !== 'browserd').join(', ')}`);
await commands[cmd]();
