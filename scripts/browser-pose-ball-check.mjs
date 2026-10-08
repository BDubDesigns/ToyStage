// Deterministic interaction/lifecycle check through the production UI, tracker,
// smoother and real worker transport. ONLY this page replaces model inference
// with scripted landmarks; the main browser check still runs real Lite/WASM.
import assert from "node:assert/strict";

export async function checkPoseBall(browser, origin, instrument) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(instrument);
  await page.addInitScript(() => {
    window.scriptedLandmarks = [];
    const InstrumentedWorker = window.Worker;
    window.Worker = class extends InstrumentedWorker {
      postMessage(message, ...args) {
        super.postMessage(message.type === "frame" ? { ...message, landmarks: window.scriptedLandmarks } : message, ...args);
      }
    };
  });
  await page.route("**/assets/pose-worker-*.js", route => route.fulfill({ contentType: "text/javascript", body: `
    self.onmessage = ({ data: message }) => {
      if (message.type === "init") { self.postMessage({ type: "ready" }); return; }
      message.bitmap.close();
      self.postMessage({ type: "result", token: message.token, landmarks: message.landmarks,
        inferenceMs: 0, completedAtEpoch: performance.timeOrigin + performance.now() });
    };` }));
  const setPose = async (joint, x, y, visibility = 1) => page.evaluate(({ joint, x, y, visibility }) => {
    const points = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0, presence: 1 }));
    for (const [i, px, py] of [[11, 0.35, 0.25], [12, 0.65, 0.25], [23, 0.4, 0.65], [24, 0.6, 0.65]]) {
      points[i] = { x: px, y: py, visibility: 1, presence: 1 };
    }
    points[joint] = { x, y, visibility, presence: 1 };
    window.scriptedLandmarks = [points];
  }, { joint, x, y, visibility });
  const waitSamples = async (count = 4) => {
    const before = await page.evaluate(() => probe.results.length);
    await page.waitForFunction(target => probe.results.length >= target, before + count);
  };
  const diagnostics = () => page.locator("#ball-diagnostics").textContent();
  const waitHits = hits => page.waitForFunction(hits => document.querySelector("#ball-diagnostics").textContent.endsWith(`· ${hits} hits`), hits);
  const reset = async () => { await page.locator("#reset-ball").click(); await waitHits(0); };
  await page.goto(origin);
  await setPose(15, 0.3, 0.45);
  await page.locator("#mode-pose").click(); await page.locator("#camera-button").click();
  await page.waitForFunction(() => document.querySelector("#pose-count").textContent.startsWith("1 / 1"));
  await page.locator(".ball-panel details summary").click(); await page.locator("#ball-debug").check();
  assert(await page.locator("#ball-overlay").isVisible());
  assert(await page.locator("#reset-ball").isEnabled()); assert(await page.locator("#place-ball").isEnabled());
  // Hidden Green-screen switches must have no bearing on Pose contacts.
  await page.evaluate(() => {
    for (const id of ["key-enabled", "sensing-enabled"]) {
      const control = document.getElementById(id); control.checked = false; control.dispatchEvent(new Event("change"));
    }
  });
  for (const type of ["eight-ball", "basketball", "bowling-ball", "super-ball", "dodgeball", "balloon"]) {
    await page.locator(`[data-ball-type="${type}"]`).click(); await waitHits(0);
    const label = type === "eight-ball" ? "8 Ball" : type === "balloon" ? "Air-filled Balloon" : type.split("-").map(s => s[0].toUpperCase() + s.slice(1)).join(" ");
    await page.waitForFunction(label => document.querySelector("#ball-diagnostics").textContent.startsWith(label), label);
    assert((await diagnostics()).startsWith(label));
  }
  await page.locator('[data-ball-type="eight-ball"]').click();
  for (const [joint, part] of [[15, "left hand"], [16, "right hand"], [27, "left foot"], [28, "right foot"], [0, "head"]]) {
    const foot = joint === 27 || joint === 28, head = joint === 0;
    await setPose(joint, head || foot ? 0.5 : 0.3, head ? 0.24 : foot ? 0.65 : 0.45);
    await waitSamples(); await reset();
    await setPose(joint, head || foot ? 0.5 : 0.48, head ? 0.4 : foot ? 0.48 : 0.45);
    await waitHits(1);
    assert((await diagnostics()).includes(`last ${part}`));
    assert(!(await diagnostics()).includes("velocity (0.00, 0.00)"));
  }

  // Stationary overlapping head must neither auto-hit nor pump. Placement is
  // on the Pose canvas, inside its fitted rectangle, and seeds fresh history.
  await setPose(0, 0.5, 0.45); await waitSamples(); await reset();
  await page.waitForTimeout(600); await waitHits(0);
  await page.locator("#place-ball").click();
  await page.locator("#pose-canvas").click({ position: { x: (await page.locator("#pose-canvas").boundingBox()).width / 2, y: (await page.locator("#pose-canvas").boundingBox()).height / 2 } });
  assert.equal(await page.locator("#place-ball").getAttribute("aria-pressed"), "false");
  await page.waitForTimeout(400); await waitHits(0);

  await setPose(15, 0.3, 0.45); await waitSamples(); await reset();
  await setPose(15, 0.48, 0.45, 0.1); await waitSamples(); await waitHits(0);
  await setPose(15, 0.48, 0.45); await waitSamples(); await waitHits(0);
  await page.evaluate(() => { window.scriptedLandmarks = []; }); await waitSamples(6);
  assert((await diagnostics()).includes("Paused"));
  await setPose(15, 0.48, 0.45); await waitSamples(); await waitHits(0);
  await page.evaluate(() => { probe.stopFrames = true; }); await page.waitForTimeout(800);
  assert((await diagnostics()).includes("Paused"));
  await page.evaluate(() => { probe.stopFrames = false; }); await waitSamples(); await waitHits(0);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => probe.hidden });
    probe.hidden = true; document.dispatchEvent(new Event("visibilitychange"));
  });
  assert(await page.locator("#ball-overlay").isHidden());
  await page.evaluate(() => { probe.hidden = false; document.dispatchEvent(new Event("visibilitychange")); });
  await waitSamples(); await waitHits(0);

  // Mobile portrait + front mirror strike, then landscape + rear. Switching
  // clears old contacts and keeps exactly one camera stream.
  for (const [width, height, device] of [[412, 915, "front"], [915, 412, "rear"]]) {
    await page.setViewportSize({ width, height });
    await page.locator("#camera-select").selectOption(device); await waitSamples(); await waitHits(0);
    await setPose(16, 0.3, 0.45); await waitSamples(); await reset();
    await setPose(16, 0.48, 0.45); await waitHits(1);
    assert((await diagnostics()).includes("last right hand"));
    assert(await page.evaluate(() => probe.streams.filter(s => s.getTracks().some(t => t.readyState === "live")).length === 1));
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (process.env.POSE_BALL_SCREENSHOT && device === "front") await page.locator("#stage-frame").screenshot({ path: process.env.POSE_BALL_SCREENSHOT });
  }
  const requests = await page.evaluate(() => probe.cameraRequests);
  await page.locator("#mode-green").click(); await page.locator("#mode-pose").click();
  await waitSamples(); await waitHits(0);
  assert.equal(await page.evaluate(() => probe.cameraRequests), requests);
  await page.locator("#ball-enabled").uncheck(); assert(await page.locator("#ball-overlay").isHidden());
  await page.locator("#ball-enabled").check(); await waitSamples(); await waitHits(0);
  await page.locator("#camera-button").click(); assert(await page.locator("#ball-overlay").isHidden());
  assert.equal(await page.evaluate(() => probe.workers.size), 0);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ poseBall: "passed", scriptedBodyParts: 5, maskDisabled: true, mobileAndMirror: true, physicalDeviceAcceptance: "pending" }));
  await page.close();
}
