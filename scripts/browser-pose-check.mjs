// Production-build smoke/lifecycle check. No camera permission or physical device
// is needed: a transient synthetic Canvas stream supplies blank/toy/fixture input.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const port = 5193;
const origin = `http://127.0.0.1:${port}`;
const fixture = process.env.POSE_FIXTURE;
const seconds = Number(process.env.POSE_MEASURE_SECONDS ?? 5);
const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { cwd: new URL("../", import.meta.url), stdio: ["ignore", "pipe", "pipe"] });
let browser;
const errors = [];
const requests = [];

function instrument() {
  window.probe = { cameraRequests: 0, streams: [], sources: [], workers: new Set(), results: [], maxOutstanding: 0, scene: "body", failDevice: "", hidden: false, stopFrames: false, offered: 0 };
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    outstanding = 0;
    constructor(...args) {
      super(...args); probe.workers.add(this);
      this.addEventListener("message", (event) => {
        if (event.data.type === "result") {
          this.outstanding--;
          probe.results.push({ token: event.data.token, inferenceMs: event.data.inferenceMs, count: event.data.landmarks[0]?.length ?? 0 });
        } else if (event.data.type === "error") this.outstanding = 0;
      });
    }
    postMessage(message, ...args) {
      if (message.type === "frame") {
        probe.offered++; this.outstanding++;
        probe.maxOutstanding = Math.max(probe.maxOutstanding, this.outstanding);
      }
      return super.postMessage(message, ...args);
    }
    terminate() { this.outstanding = 0; probe.workers.delete(this); return super.terminate(); }
  };
  navigator.mediaDevices.enumerateDevices = async () => ["rear", "front", "broken"].map((id) => ({ kind: "videoinput", deviceId: id, label: `${id} camera` }));
  navigator.mediaDevices.getUserMedia = async (constraints) => {
    probe.cameraRequests++;
    assertOneStream();
    const id = constraints.video.deviceId?.exact ?? "rear";
    if (id === probe.failDevice || id === "broken") throw new DOMException("Test device unavailable", "NotReadableError");
    const source = document.createElement("canvas");
    source.width = id === "front" ? 720 : 1280; source.height = id === "front" ? 1280 : 720;
    probe.sources.push(source);
    const ctx = source.getContext("2d");
    let image;
    if (window.hasFixture) { image = new Image(); image.src = "/__pose-fixture.jpg"; await image.decode(); }
    const paint = () => {
      if (probe.stopFrames) return;
      ctx.fillStyle = "#14cc1f"; ctx.fillRect(0, 0, source.width, source.height);
      if (probe.scene === "body" && image) {
        const scale = Math.min(source.width / image.width, source.height / image.height) * 0.86;
        const x = (source.width - image.width * scale) / 2 + Math.sin(performance.now() / 1500) * source.width * 0.025;
        ctx.drawImage(image, x, (source.height - image.height * scale) / 2, image.width * scale, image.height * scale);
      } else if (probe.scene === "toy") {
        ctx.fillStyle = "#ff394f"; ctx.fillRect(source.width * 0.4, source.height * 0.4, source.width * 0.12, source.height * 0.12);
      }
    };
    paint();
    const timer = setInterval(paint, 1000 / 30);
    const stream = source.captureStream(30), track = stream.getVideoTracks()[0], nativeStop = track.stop.bind(track);
    track.getSettings = () => ({ deviceId: id, facingMode: id === "front" ? "user" : "environment", frameRate: 30, width: source.width, height: source.height });
    track.stop = () => { clearInterval(timer); nativeStop(); };
    probe.streams.push(stream);
    return stream;
  };
  function assertOneStream() {
    if (probe.streams.some((stream) => stream.getTracks().some((track) => track.readyState === "live"))) throw new Error("Requested a second live camera stream");
  }
}

const waitLive = (page) => page.waitForFunction(() => document.querySelector("#camera-state").dataset.state === "live");
const waitPose = (page) => page.waitForFunction(() => document.querySelector("#pose-worker-state").textContent.startsWith("ready"), null, { timeout: 30000 });
const waitFigure = (page) => page.waitForFunction(() => document.querySelector("#pose-count").textContent.startsWith("1 / 1"));
const liveCount = (page) => page.evaluate(() => probe.streams.filter((s) => s.getTracks().some((t) => t.readyState === "live")).length);
const cameraRequests = (page) => page.evaluate(() => probe.cameraRequests);

async function measure(page, label) {
  const rows = [];
  for (let i = 0; i < seconds; i++) {
    await page.waitForTimeout(1000);
    rows.push(await page.evaluate(() => Object.fromEntries(["render-rate", "frame-time", "submission-time", "pose-sample-rate", "pose-inference-time", "pose-capture-time", "sensing-rate", "sensing-time"].map((id) => [id, document.getElementById(id).textContent]))));
  }
  const average = (id) => +(rows.reduce((sum, row) => sum + parseFloat(row[id]), 0) / rows.length).toFixed(2);
  console.log(JSON.stringify({ label, seconds, averageRenderFps: average("render-rate"), averageFrameMs: average("frame-time"), averageDrawOrSubmissionMs: average("submission-time"), last: rows.at(-1) }));
}

try {
  await new Promise((resolve, reject) => {
    server.stdout.on("data", (data) => { if (String(data).includes(origin)) resolve(); });
    server.stderr.on("data", (data) => console.error(String(data).trim()));
    server.on("exit", (code) => reject(new Error(`Preview exited: ${code}`)));
  });
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, headless: true,
    args: ["--no-sandbox", "--no-zygote", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => requests.push({ url: request.url(), method: request.method() }));
  if (fixture) await page.route(`${origin}/__pose-fixture.jpg`, (route) => route.fulfill({ path: fixture, contentType: "image/jpeg" }));
  await page.addInitScript(instrument);
  await page.addInitScript((value) => { window.hasFixture = value; }, Boolean(fixture));
  await page.goto(origin);
  assert.equal(await page.locator("#mode-green").getAttribute("aria-pressed"), "true");
  await page.locator("#mode-pose").click();
  await page.locator("#camera-button").click(); await waitLive(page); await waitPose(page);
  if (fixture) await waitFigure(page);
  assert.equal(await cameraRequests(page), 1);
  assert.equal(await liveCount(page), 1);
  assert(await page.locator("#stage-canvas").isHidden());
  assert(await page.locator("#stage-video").isHidden());
  assert(await page.locator(".key-panel").isHidden());
  await measure(page, fixture ? "Pose / moving public test image / SwiftShader" : "Pose / empty synthetic camera / SwiftShader");

  // Live mode switches reuse the exact stream and preserve unrelated controls.
  await page.evaluate(() => { probe.scene = "toy"; window.originalStream = document.querySelector("#stage-video").srcObject; });
  await page.locator("#mode-green").click();
  await page.waitForFunction(() => document.querySelector("#ball-status").textContent.includes("Nudge"));
  assert.equal(await page.locator(".ball-card").count(), 6);
  for (const type of ["eight-ball", "basketball", "bowling-ball", "super-ball", "dodgeball", "balloon"]) {
    await page.locator(`[data-ball-type="${type}"]`).click();
    assert.equal(await page.locator(`[data-ball-type="${type}"]`).getAttribute("aria-pressed"), "true");
  }
  await page.locator(".scene-card").nth(2).click();
  await page.waitForFunction(() => document.querySelector("#scene-status").textContent.includes("ready"));
  await page.locator("#key-tolerance").fill("0.32");
  await measure(page, "Green-screen / toy / SwiftShader");
  const scene = await page.locator('.scene-card[aria-pressed="true"] span').textContent();
  await page.evaluate(() => { probe.scene = "body"; });
  await page.locator("#mode-pose").click(); await waitPose(page);
  if (fixture) await waitFigure(page);
  assert.equal(await cameraRequests(page), 1);
  assert(await page.evaluate(() => originalStream === document.querySelector("#stage-video").srcObject));
  assert.equal(await page.evaluate(() => probe.workers.size), 1);

  // No person, stopped decoded input, hide/resume, resize and mapping reset.
  await page.evaluate(() => { probe.scene = "empty"; });
  await page.waitForFunction(() => document.querySelector("#pose-count").textContent.startsWith("0 / 1"));
  assert(await page.locator("#pose-prompt").isVisible());
  await page.evaluate(() => { probe.scene = "body"; });
  if (fixture) await waitFigure(page);
  await page.evaluate(() => { probe.stopFrames = true; });
  await page.waitForTimeout(800);
  assert.equal(await page.locator("#pose-age").textContent(), "No fresh pose");
  await page.evaluate(() => { probe.stopFrames = false; });
  if (fixture) await waitFigure(page);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => probe.hidden });
    probe.hidden = true; document.dispatchEvent(new Event("visibilitychange"));
  });
  const offered = await page.evaluate(() => probe.offered);
  await page.waitForTimeout(450);
  assert.equal(await page.evaluate(() => probe.offered), offered);
  assert.equal(await page.locator("#render-rate").textContent(), "Paused while hidden");
  await page.evaluate(() => { probe.hidden = false; document.dispatchEvent(new Event("visibilitychange")); });
  if (fixture) await waitFigure(page);
  await page.setViewportSize({ width: 412, height: 915 });
  await page.locator("#camera-select").selectOption("front"); await waitLive(page); await waitPose(page);
  assert.equal(await liveCount(page), 1);
  assert((await page.locator("#camera-view").textContent()).startsWith("Mirrored"));
  if (fixture) await waitFigure(page);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  if (process.env.POSE_SCREENSHOT) await page.locator("#stage-frame").screenshot({ path: process.env.POSE_SCREENSHOT });
  await page.setViewportSize({ width: 915, height: 412 });
  await page.locator("#camera-select").selectOption("rear"); await waitLive(page); await waitPose(page);
  await page.locator("#camera-select").selectOption("broken");
  await page.waitForFunction(() => document.querySelector("#camera-switch-status").textContent.includes("previous camera is back"));
  await waitPose(page); assert.equal(await liveCount(page), 1);

  // Model failure/retry leaves the same stream and a working Green-screen mode.
  await page.locator("#mode-green").click();
  await page.route("**/pose/pose_landmarker_lite-float16-v1.task", (route) => route.fulfill({ status: 503, body: "Test model unavailable" }));
  const beforeFailure = await cameraRequests(page);
  await page.locator("#mode-pose").click();
  await page.waitForFunction(() => document.querySelector("#pose-worker-state").textContent.startsWith("error"));
  assert(await page.locator("#pose-retry").isVisible());
  assert.equal(await liveCount(page), 1);
  await page.unroute("**/pose/pose_landmarker_lite-float16-v1.task");
  await page.locator("#pose-retry").click(); await waitPose(page);
  assert.equal(await cameraRequests(page), beforeFailure);
  await page.locator("#mode-green").click();
  assert.equal(await page.locator("#key-tolerance").inputValue(), "0.32");
  assert.equal(await page.locator('.scene-card[aria-pressed="true"] span').textContent(), scene);
  assert.equal(await page.locator('[data-ball-type="balloon"]').getAttribute("aria-pressed"), "true");
  assert.equal(await page.evaluate(() => probe.workers.size), 0);

  // Repeat rapid toggles and stop/start while the model loads.
  for (let i = 0; i < 4; i++) { await page.locator("#mode-pose").click(); await page.locator("#mode-green").click(); }
  assert.equal(await liveCount(page), 1);
  await page.locator("#mode-pose").click();
  await page.locator("#camera-button").click();
  assert.equal(await liveCount(page), 0); assert.equal(await page.evaluate(() => probe.workers.size), 0);
  await page.locator("#camera-button").click(); await waitLive(page); await waitPose(page);
  await page.evaluate(() => {
    const track = document.querySelector("#stage-video").srcObject.getVideoTracks()[0];
    track.stop(); track.dispatchEvent(new Event("ended"));
  });
  assert.equal(await liveCount(page), 0); assert(await page.locator("#pose-canvas").isHidden());
  await page.locator("#camera-button").click(); await waitLive(page);
  await page.locator("#mode-green").click();
  await page.evaluate(() => document.querySelector("#stage-canvas").getContext("webgl2").getExtension("WEBGL_lose_context").loseContext());
  await page.waitForFunction(() => document.querySelector("#camera-state").dataset.state === "error");
  assert.equal(await liveCount(page), 0); assert.equal(await page.evaluate(() => probe.workers.size), 0);
  await page.locator("#mode-pose").click(); await page.locator("#camera-button").click(); await waitLive(page);
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  assert.equal(await liveCount(page), 0); assert.equal(await page.evaluate(() => probe.workers.size), 0);

  // A main-canvas WebGL2 failure does not gate Pose camera permission/start.
  const noGl = await browser.newPage();
  await noGl.addInitScript(instrument);
  await noGl.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) { return type === "webgl2" ? null : getContext.call(this, type, ...args); };
    // Exercise the bounded currentTime fallback alongside the no-main-WebGL path.
    Object.defineProperty(HTMLVideoElement.prototype, "requestVideoFrameCallback", { configurable: true, value: undefined });
  });
  await noGl.goto(origin);
  await noGl.locator("#camera-button").click();
  await noGl.waitForFunction(() => document.querySelector("#camera-state").dataset.state === "error");
  assert.equal(await cameraRequests(noGl), 0);
  await noGl.locator("#mode-pose").click(); await noGl.locator("#camera-button").click(); await waitLive(noGl); await waitPose(noGl);
  await noGl.waitForFunction(() => probe.results.length > 0);
  assert.equal(await cameraRequests(noGl), 1);
  await noGl.locator("#camera-button").click(); assert.equal(await liveCount(noGl), 0);
  const result = await page.evaluate(() => ({ maxOutstanding: probe.maxOutstanding, results: probe.results.length, real33LandmarkResults: probe.results.filter((result) => result.count === 33).length }));
  assert.equal(result.maxOutstanding, 1);
  if (fixture) assert(result.real33LandmarkResults > 0);
  assert.deepEqual(errors, []);
  assert(requests.every((request) => request.url.startsWith(origin) && request.method === "GET"));
  console.log(JSON.stringify({ passed: true, ...result, sameOriginGetRequestsOnly: true, fixture: Boolean(fixture), physicalDeviceAcceptance: "pending" }));
} finally {
  await browser?.close();
  server.kill();
}
