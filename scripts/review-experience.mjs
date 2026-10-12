// Browser acceptance companion. Run ONLY against the provided temporary review
// server: the flow creates and removes synthetic props. No voice/API/device.
// node scripts/review-experience.mjs --url=http://127.0.0.1:8092 --output=../review-output
import { chromium } from "playwright-core";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const options = Object.fromEntries(
  process.argv.slice(2).map((s) => s.replace(/^--/, "").split("=")),
);
const url = options.url || "http://127.0.0.1:8092",
  output = path.resolve(options.output || ".local/experience-review");
if (!["127.0.0.1", "localhost"].includes(new URL(url).hostname))
  throw new Error("Review server must be local.");
await mkdir(output, { recursive: true });
const report = {
  scope:
    "Real Chromium UI on a temporary synthetic simulation; no cloud voice or hardware. Frame timings describe this browser/machine only.",
  started: new Date().toISOString(),
  viewports: [],
  flows: [],
  errors: [],
};
let browser;
try {
  const health = await fetch(url + "/api/review-mode").then((r) => r.json());
  if (health.synthetic !== true)
    throw new Error(
      "Start scripts/serve-experience-review.py first; normal scenes are not accepted for automated mutations.",
    );
  browser = await chromium.launch({
    chromiumSandbox: true,
    ...(options.chromium ? { executablePath: options.chromium } : {}),
  });
  report.browser = browser.version();
  const context = await browser.newContext({ deviceScaleFactor: 1 });
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === new URL(url).origin
      ? route.continue()
      : route.abort(),
  );
  const page = await context.newPage();
  page.on("pageerror", (e) => report.errors.push(e.message));
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () =>
      document.querySelector("#loading")?.hidden &&
      document
        .querySelector("#connection-label")
        ?.textContent.includes("仿真就绪"),
  );
  for (const [width, height] of [
    [1920, 1080],
    [1440, 900],
    [1280, 720],
    [1080, 720],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: path.join(output, `main-${width}x${height}.png`),
      fullPage: true,
    });
    const geometry = await page.evaluate(() => ({
      dpr: devicePixelRatio,
      zoom: visualViewport.scale,
      overflow: document.documentElement.scrollWidth > innerWidth,
      phaseVisible:
        getComputedStyle(document.querySelector("#workshop-phase")).display !==
        "none",
      scene: (() => {
        const r = document.querySelector("#scene").getBoundingClientRect();
        return { width: r.width, height: r.height };
      })(),
    }));
    report.viewports.push({ width, height, ...geometry });
    if (geometry.overflow || !geometry.phaseVisible)
      throw new Error(`Layout overflow or hidden phase at ${width}x${height}`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page
    .getByRole("button", { name: "添加道具，开始体验", exact: true })
    .click();
  const add = async (kind, color) => {
    await page.getByLabel("添加的道具类型").selectOption(kind);
    if (color)
      await page.getByLabel("道具颜色", { exact: true }).selectOption(color);
    await page.locator(".spawn-controls button").click();
    await page.waitForFunction(
      () =>
        document
          .querySelector("#workshop-controls")
          .getAttribute("aria-busy") === "false",
    );
    if (
      (await page.locator(".control-notice").getAttribute("data-error")) ===
      "true"
    )
      throw new Error(await page.locator(".control-notice").textContent());
  };
  await add("ball", "blue");
  await add("tray", "red");
  const objects = await page.evaluate(() =>
    fetch("/api/workshop/state")
      .then((r) => r.json())
      .then((s) => s.objects),
  );
  const ball = objects.find((o) => o.kind === "ball"),
    tray = objects.find((o) => o.kind === "tray");
  await page.getByLabel("抓取对象", { exact: true }).selectOption(ball.id);
  await page.getByLabel("放置目标", { exact: true }).selectOption(tray.id);
  await page.getByRole("button", { name: "开始抓放", exact: true }).click();
  await page
    .getByRole("button", { name: "暂停任务", exact: true })
    .waitFor({ state: "visible" });
  await page.waitForFunction(
    () => !document.querySelector('[data-action="pause"]').disabled,
  );
  await page.getByRole("button", { name: "暂停任务", exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector('[data-action="resume"]'),
  );
  await page.getByRole("button", { name: "继续任务", exact: true }).click();
  await page.getByRole("button", { name: "停止任务", exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector("#workshop-phase").textContent.includes("停止"),
  );
  report.flows.push(
    "real local add/select/pick-place/pause/resume/stop, optional speech blocked",
  );
  const sceneId = await page.evaluate(() =>
    fetch("/api/workshop/state")
      .then((r) => r.json())
      .then((s) => s.scene_id),
  );
  for (const name of ["抓取台", "焊接工位", "全景"]) {
    await page.getByRole("button", { name, exact: true }).click();
    await page.waitForFunction(
      () =>
        document
          .querySelector("#workshop-controls")
          .getAttribute("aria-busy") === "false",
    );
  }
  const after = await page.evaluate(() =>
    fetch("/api/workshop/state").then((r) => r.json()),
  );
  if (
    after.scene_id !== sceneId ||
    !after.objects.some((o) => o.id === ball.id)
  )
    throw new Error("View changes altered scene or IDs.");
  report.flows.push("three view changes preserve world and stable object IDs");
  for (const topic of [
    "coordinates",
    "inverse_kinematics",
    "pointnet",
    "planning",
  ]) {
    await page.locator(`[data-lesson-topic="${topic}"]`).click();
    await page.waitForFunction(
      (t) => window.xiaomengPrinciples.state().topic === t,
      topic,
    );
    await page.locator(".principle-play").click();
    await page.locator(".principle-seek").focus();
    await page.keyboard.press("ArrowRight");
    await page.locator(".principle-replay").click();
    await page.screenshot({
      path: path.join(output, `lesson-${topic}-1440x900.png`),
      fullPage: true,
    });
  }
  report.flows.push("four local recorded lessons, transport and keyboard seek");
  report.performance = await page.evaluate(async () => {
    const intervals = [],
      longTasks = [];
    let last;
    const observer = new PerformanceObserver((list) =>
      longTasks.push(...list.getEntries().map((e) => e.duration)),
    );
    try {
      observer.observe({ type: "longtask", buffered: false });
    } catch {}
    await new Promise((resolve) => {
      const start = performance.now();
      function tick(now) {
        if (last != null) intervals.push(now - last);
        last = now;
        if (now - start < 10000) requestAnimationFrame(tick);
        else resolve();
      }
      requestAnimationFrame(tick);
    });
    observer.disconnect();
    intervals.sort((a, b) => a - b);
    const q = (p) =>
      intervals[
        Math.min(intervals.length - 1, Math.ceil(intervals.length * p) - 1)
      ];
    return {
      sampleSeconds: 10,
      workload: "local lesson playback, stopped robot",
      frameIntervalMs: {
        samples: intervals.length,
        p50: q(0.5),
        p95: q(0.95),
        p99: q(0.99),
      },
      longTasks,
      metrics: window.xiaomengPerformance.snapshot(),
    };
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "抓取台", exact: true }).click();
  await page.screenshot({
    path: path.join(output, "reduced-motion-1440x900.png"),
    fullPage: true,
  });
  if (report.errors.length) throw new Error("Browser page errors present.");
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.blocked = error.stack || String(error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await writeFile(
    path.join(output, "browser-review.json"),
    JSON.stringify(report, null, 2),
  );
}
console.log(
  JSON.stringify(
    {
      passed: report.passed,
      viewports: report.viewports.length,
      flows: report.flows,
      blocked: report.blocked?.split("\n")[0],
    },
    null,
    2,
  ),
);
